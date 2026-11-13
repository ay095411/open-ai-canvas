//go:build unix

package runtime

import (
	"os"
	"syscall"
)

func runtimeProcessAlive(pid int) bool {
	if pid <= 0 {
		return true
	}
	return syscall.Kill(pid, 0) != syscall.ESRCH
}

func directoryOwnedByCurrentUser(info os.FileInfo) bool {
	stat, ok := info.Sys().(*syscall.Stat_t)
	return ok && stat.Uid == uint32(os.Getuid())
}

func createRuntimeRoot(path string) error { return os.MkdirAll(path, 0o700) }

func runtimePathIsPrivate(_ string, info os.FileInfo) bool {
	return info.Mode().Perm()&0o077 == 0 && directoryOwnedByCurrentUser(info)
}
