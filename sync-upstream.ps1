<#
.SYNOPSIS
    Pi Web 上游代码一键拉取与融合脚本 (PowerShell 版)
.DESCRIPTION
    1. 自动保存未提交工作区（git stash）
    2. 拉取 upstream (agegr/pi-web) 最新分支与 Tags
    3. 同步本地 upstream-main 镜像分支 (fast-forward)
    4. 将 upstream-main 融入当前本地分支 (git merge)
    5. 自动运行 TypeScript 类型健康检查 (tsc --noEmit)
    6. 恢复之前保存的工作区 (git stash pop)
#>

$ErrorActionPreference = "Stop"

function Write-Step ($msg) {
    Write-Host "`n====> $msg" -ForegroundColor Cyan
}

function Write-Success ($msg) {
    Write-Host " [√] $msg" -ForegroundColor Green
}

function Write-Warn ($msg) {
    Write-Host " [!] $msg" -ForegroundColor Yellow
}

function Write-Err ($msg) {
    Write-Host " [X] $msg" -ForegroundColor Red
}

try {
    # 0. 确认 upstream 远程仓库存在
    $remotes = git remote
    if ($remotes -notcontains "upstream") {
        Write-Err "未找到名为 'upstream' 的远程仓库！请先执行: git remote add upstream https://github.com/agegr/pi-web.git"
        exit 1
    }

    $currentBranch = (git branch --show-current).Trim()
    if (-not $currentBranch) {
        Write-Err "当前处于 Detached HEAD 状态，请先切回具体分支！"
        exit 1
    }
    Write-Step "当前工作分支: $currentBranch"

    # 1. 检测工作区脏状态并临时暂存
    $status = (git status --porcelain)
    $hasStash = $false
    if ($status) {
        Write-Warn "工作区存在未提交的更改，正在自动保存现场 (git stash)..."
        git stash push -u -m "auto-stash-before-sync-$(Get-Date -Format 'yyyyMMddHHmmss')"
        $hasStash = $true
        Write-Success "现场已安全暂存"
    }

    # 2. 抓取 upstream 最新内容
    Write-Step "1/5 正在从 upstream 抓取更新与 Tags..."
    git fetch upstream --prune --tags
    Write-Success "上游更新抓取完成"

    # 3. 检查并更新本地 upstream-main 分支
    Write-Step "2/5 正在更新本地 upstream-main 镜像分支..."
    $localBranches = git branch --format="%(refname:short)"
    if ($localBranches -contains "upstream-main") {
        git checkout upstream-main
        git merge upstream/main --ff-only
    } else {
        Write-Warn "本地尚未建立 upstream-main 分支，正在从 upstream/main 初始化..."
        git checkout -b upstream-main upstream/main
    }
    Write-Success "upstream-main 镜像分支已追平至最新"

    # 可选推送镜像分支至个人远端 origin
    try {
        Write-Host "正在同步镜像到个人远端 origin/upstream-main..." -ForegroundColor Gray
        git push origin upstream-main
    } catch {
        Write-Warn "推送 upstream-main 到 origin 遇到警告（可忽略）"
    }

    # 4. 切回原开发分支并融合
    Write-Step "3/5 切回原分支 [$currentBranch] 并融合 upstream-main..."
    git checkout $currentBranch

    $mergeOutput = git merge upstream-main -m "chore: merge upstream changes from upstream-main" 2>&1
    Write-Host $mergeOutput

    if ($LASTEXITCODE -ne 0) {
        Write-Err "合并遇到冲突！请手动检查并解决冲突文件，然后完成 commit。"
        if ($hasStash) {
            Write-Warn "注意：您之前未提交的代码仍保存在 git stash 中。解决冲突并 commit 后，请执行: git stash pop"
        }
        exit 1
    }
    Write-Success "上游变更已成功合并入 [$currentBranch]"

    # 5. 执行项目健康检查
    Write-Step "4/5 运行类型检查 (node_modules/.bin/tsc --noEmit)..."
    if (Test-Path "node_modules/.bin/tsc") {
        & node_modules/.bin/tsc --noEmit
        if ($LASTEXITCODE -eq 0) {
            Write-Success "TypeScript 类型检查全部通过！"
        } else {
            Write-Warn "类型检查存在警告/错误，请根据上方输出排查！"
        }
    } else {
        Write-Warn "未找到 node_modules/.bin/tsc，跳过类型检查。"
    }

    # 6. 恢复工作区
    if ($hasStash) {
        Write-Step "5/5 正在恢复之前暂存的工作现场 (git stash pop)..."
        git stash pop
        Write-Success "工作现场已顺利还原"
    }

    Write-Host "`n========================================================" -ForegroundColor Green
    Write-Host " [√] 上游代码同步与融合流程全部顺利完成！" -ForegroundColor Green
    Write-Host "========================================================`n"

} catch {
    Write-Err "执行过程中发生异常: $_"
    exit 1
}
