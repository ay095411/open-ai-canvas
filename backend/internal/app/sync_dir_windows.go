//go:build windows

package app

// syncDir 在 Windows 上是空操作。
// 目录句柄由 os.Open 以 FILE_FLAG_BACKUP_SEMANTICS 打开，对其调用 FlushFileBuffers
// 会以 ERROR_ACCESS_DENIED 失败（Go 侧表现为 *fs.PathError "Access is denied"）。
// NTFS 的目录元数据由文件系统日志保证，无需（也无法）在此手动刷盘。
func syncDir(string) error { return nil }
