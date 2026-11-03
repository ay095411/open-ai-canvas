//go:build !windows

package app

import "syscall"

// transportResetErrors 列出可视为「连接被对端中断」的系统错误。
func transportResetErrors() []error {
	return []error{syscall.ECONNRESET, syscall.ECONNABORTED, syscall.EPIPE}
}
