use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;

#[cfg(target_os = "windows")]
use std::os::windows::io::AsRawHandle;

pub struct ProcessManager {
    child: Mutex<Option<Child>>,
    #[cfg(target_os = "windows")]
    _job: Mutex<Option<win_job::KillOnCloseJob>>,
}

impl ProcessManager {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            #[cfg(target_os = "windows")]
            _job: Mutex::new(None),
        }
    }

    pub fn is_port_listening(&self, port: u16) -> bool {
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
    }

    pub fn find_project_root(&self) -> PathBuf {
        // Try current working directory first
        if let Ok(cwd) = std::env::current_dir() {
            if cwd.join("server.mjs").exists() || cwd.join("package.json").exists() {
                return cwd;
            }
            if let Some(parent) = cwd.parent() {
                if parent.join("server.mjs").exists() || parent.join("package.json").exists() {
                    return parent.to_path_buf();
                }
            }
        }

        // Try exe location ancestors
        if let Ok(exe) = std::env::current_exe() {
            let mut curr = exe.as_path();
            while let Some(parent) = curr.parent() {
                if parent.join("server.mjs").exists() || parent.join("package.json").exists() {
                    return parent.to_path_buf();
                }
                curr = parent;
            }
        }

        PathBuf::from(".")
    }

    pub fn ensure_server_running(&self, port: u16) -> Result<(), String> {
        if self.is_port_listening(port) {
            log::info!("Port {} is already listening; using existing server.", port);
            return Ok(());
        }

        log::info!("Port {} is not active; starting Node.js server...", port);
        let root = self.find_project_root();
        log::info!("Using project root: {:?}", root);

        let mut cmd = if cfg!(target_os = "windows") {
            let mut c = Command::new("cmd");
            c.args(["/c", "npm", "run", "dev"]);
            c
        } else {
            let mut c = Command::new("npm");
            c.args(["run", "dev"]);
            c
        };

        cmd.current_dir(&root);
        cmd.env("PORT", port.to_string());
        cmd.env("PI_WEB_HOSTNAME", "127.0.0.1");

        // Spawn child
        let child = cmd.spawn().map_err(|e| format!("Failed to spawn Node server: {}", e))?;

        #[cfg(target_os = "windows")]
        {
            if let Some(job) = win_job::KillOnCloseJob::new() {
                let raw = child.as_raw_handle();
                let _ = job.assign_process(raw);
                let mut job_lock = self._job.lock().unwrap();
                *job_lock = Some(job);
            }
        }

        let mut child_lock = self.child.lock().unwrap();
        *child_lock = Some(child);

        // Wait for port to become active (up to 30 seconds)
        log::info!("Waiting for port {} to become responsive...", port);
        for _ in 0..60 {
            std::thread::sleep(Duration::from_millis(500));
            if self.is_port_listening(port) {
                log::info!("Node.js server is ready at http://127.0.0.1:{}", port);
                return Ok(());
            }
        }

        Err(format!("Server did not start listening on port {} within 30 seconds", port))
    }

    pub fn stop_managed_server(&self) {
        let mut child_lock = self.child.lock().unwrap();
        if let Some(mut child) = child_lock.take() {
            log::info!("Stopping managed Node.js server...");
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[cfg(target_os = "windows")]
mod win_job {
    use std::ffi::c_void;
    use std::mem::size_of;
    use std::os::windows::io::RawHandle;
    use std::ptr::null_mut;

    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: i32 = 9;
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x2000;

    #[repr(C)]
    struct IoCounters {
        read_operation_count: u64,
        write_operation_count: u64,
        other_operation_count: u64,
        read_transfer_count: u64,
        write_transfer_count: u64,
        other_transfer_count: u64,
    }

    #[repr(C)]
    struct BasicLimitInformation {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: u32,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }

    #[repr(C)]
    struct ExtendedLimitInformation {
        basic_limit_information: BasicLimitInformation,
        io_info: IoCounters,
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }

    unsafe extern "system" {
        fn CreateJobObjectW(lp_job_attributes: *mut c_void, lp_name: *const u16) -> RawHandle;
        fn SetInformationJobObject(
            h_job: RawHandle,
            job_object_info_class: i32,
            lp_job_object_info: *const c_void,
            cb_job_object_info_length: u32,
        ) -> i32;
        fn AssignProcessToJobObject(h_job: RawHandle, h_process: RawHandle) -> i32;
        fn CloseHandle(h_object: RawHandle) -> i32;
    }

    pub struct KillOnCloseJob {
        handle: RawHandle,
    }

    unsafe impl Send for KillOnCloseJob {}
    unsafe impl Sync for KillOnCloseJob {}

    impl KillOnCloseJob {
        pub fn new() -> Option<Self> {
            unsafe {
                let handle = CreateJobObjectW(null_mut(), std::ptr::null());
                if handle.is_null() {
                    return None;
                }

                let mut info: ExtendedLimitInformation = std::mem::zeroed();
                info.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

                let ok = SetInformationJobObject(
                    handle,
                    JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                    &info as *const _ as *const c_void,
                    size_of::<ExtendedLimitInformation>() as u32,
                );

                if ok == 0 {
                    CloseHandle(handle);
                    return None;
                }

                Some(Self { handle })
            }
        }

        pub fn assign_process(&self, process_handle: RawHandle) -> bool {
            unsafe { AssignProcessToJobObject(self.handle, process_handle) != 0 }
        }
    }

    impl Drop for KillOnCloseJob {
        fn drop(&mut self) {
            unsafe {
                if !self.handle.is_null() {
                    CloseHandle(self.handle);
                }
            }
        }
    }
}
