//go:build !unix && !windows

package runtime

import "os"

// Unknown process liveness is treated as active; do not reclaim another owner's directory.
func runtimeProcessAlive(int) bool        { return true }
func createRuntimeRoot(path string) error { return os.MkdirAll(path, 0o700) }

func runtimePathIsPrivate(_ string, info os.FileInfo) bool {
	return info.Mode().Perm()&0o077 == 0
}
