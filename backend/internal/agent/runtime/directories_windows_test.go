//go:build windows

package runtime

import (
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows"
)

func TestRuntimeDirectoryWindowsACLRejectsOtherUsers(t *testing.T) {
	root := filepath.Join(t.TempDir(), "runs")
	t.Setenv("YINGCE_AGENT_TEMP_DIR", root)
	directory, err := createRunDirectory()
	if err != nil {
		t.Fatal(err)
	}
	defer directory.cleanup()
	for _, path := range []string{root, directory.path, filepath.Join(directory.path, runDirectoryMarker)} {
		info, err := os.Stat(path)
		if err != nil || !runtimePathIsPrivate(path, info) {
			t.Fatalf("runtime path did not inherit private access: %s %v", path, err)
		}
	}
	descriptor, err := windows.SecurityDescriptorFromString("D:P(A;OICI;FA;;;WD)")
	if err != nil {
		t.Fatal(err)
	}
	acl, _, err := descriptor.DACL()
	if err != nil {
		t.Fatal(err)
	}
	if err := windows.SetNamedSecurityInfo(root, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, acl, nil); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(root)
	if err != nil {
		t.Fatal(err)
	}
	if runtimePathIsPrivate(root, info) {
		t.Fatal("runtime accepted a directory granting access to everyone")
	}
	if _, err := createRunDirectory(); err == nil {
		t.Fatal("runtime reused a root with access granted to everyone")
	}
}
