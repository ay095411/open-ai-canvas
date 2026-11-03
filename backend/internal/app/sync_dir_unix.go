//go:build !windows

package app

import "os"

// syncDir 把新建/重命名后的目录项落盘。
// 目录 fsync 只在类 Unix 文件系统上有意义，Windows 见 sync_dir_windows.go。
func syncDir(path string) error {
	dir, err := os.Open(path)
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}
