use std::fs;
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;

#[cfg(target_os = "windows")]
use std::os::windows::io::AsRawHandle;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

fn default_port() -> u16 {
    30141
}
fn default_hostname() -> String {
    "127.0.0.1".to_string()
}
fn default_mode() -> String {
    "start".to_string()
}
fn default_true() -> bool {
    true
}
fn default_false() -> bool {
    false
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebServiceConfig {
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_hostname")]
    pub hostname: String,
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(default = "default_true")]
    pub autostart: bool,
    #[serde(default = "default_false")]
    pub open_browser_on_launch: bool,
    #[serde(default = "default_true")]
    pub auto_restart: bool,
}

impl Default for WebServiceConfig {
    fn default() -> Self {
        Self {
            port: default_port(),
            hostname: default_hostname(),
            mode: default_mode(),
            autostart: default_true(),
            open_browser_on_launch: default_false(),
            auto_restart: default_true(),
        }
    }
}

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

    pub fn get_agent_dir(&self) -> PathBuf {
        if let Some(user_home) = std::env::var_os("USERPROFILE")
            .or_else(|| std::env::var_os("HOME"))
        {
            PathBuf::from(user_home).join(".pi").join("agent")
        } else {
            PathBuf::from(".").join(".pi").join("agent")
        }
    }

    pub fn get_config_path(&self) -> PathBuf {
        self.get_agent_dir().join("web-service.json")
    }

    pub fn get_log_path(&self) -> PathBuf {
        self.get_agent_dir().join("logs").join("pi-web-service.log")
    }

    pub fn load_config(&self) -> WebServiceConfig {
        let config_file = self.get_config_path();
        if config_file.exists() {
            if let Ok(content) = fs::read_to_string(&config_file) {
                if let Ok(config) = serde_json::from_str::<WebServiceConfig>(&content) {
                    return config;
                }
            }
        }
        WebServiceConfig::default()
    }

    pub fn is_port_listening(&self, port: u16) -> bool {
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
    }

    pub fn wait_for_port_free(&self, port: u16, max_duration: Duration) -> bool {
        let start = std::time::Instant::now();
        while start.elapsed() < max_duration {
            if !self.is_port_listening(port) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(300));
        }
        !self.is_port_listening(port)
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

    pub fn ensure_server_running(&self) -> Result<(), String> {
        let config = self.load_config();
        let port = config.port;

        if self.is_port_listening(port) {
            log::info!("Port {} is already listening; using existing server.", port);
            return Ok(());
        }

        log::info!("Port {} is not active; starting Node.js server...", port);
        let root = self.find_project_root();
        log::info!("Using project root: {:?}", root);

        let mut mode = config.mode.clone();
        if mode == "start" && !root.join(".next").exists() {
            log::info!(".next directory not found. Automatically falling back to dev mode.");
            mode = "dev".to_string();
        }

        let npm_script = if mode == "start" { "start" } else { "dev" };

        let mut cmd = if cfg!(target_os = "windows") {
            let mut c = Command::new("cmd");
            c.args(["/c", "npm", "run", npm_script]);
            c
        } else {
            let mut c = Command::new("npm");
            c.args(["run", npm_script]);
            c
        };

        cmd.current_dir(&root);
        cmd.env("PORT", port.to_string());
        let bind_host = if config.hostname.is_empty() { "127.0.0.1" } else { &config.hostname };
        cmd.env("PI_WEB_HOSTNAME", bind_host);

        // Redirect stdio to prevent any console window popup and keep log intact
        let log_path = self.get_log_path();
        if let Some(parent) = log_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let stdout_file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .ok();
        let stderr_file = stdout_file.as_ref().and_then(|f| f.try_clone().ok());

        cmd.stdin(std::process::Stdio::null());
        if let Some(f) = stdout_file {
            cmd.stdout(f);
        } else {
            cmd.stdout(std::process::Stdio::null());
        }
        if let Some(f) = stderr_file {
            cmd.stderr(f);
        } else {
            cmd.stderr(std::process::Stdio::null());
        }

        #[cfg(target_os = "windows")]
        {
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

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
                log::info!("Node.js server is ready at http://{}:{}", bind_host, port);
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

    pub fn restart_managed_server(&self) -> Result<(), String> {
        let config = self.load_config();
        let port = config.port;

        self.stop_managed_server();

        // Wait up to 6 seconds for port to free up
        if !self.wait_for_port_free(port, Duration::from_secs(6)) {
            return Err(format!("Port {} could not be released in time.", port));
        }

        self.ensure_server_running()
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
