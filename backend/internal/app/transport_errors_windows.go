//go:build windows

package app

import "syscall"

// transportResetErrors 列出可视为「连接被对端中断」的系统错误。
//
// Windows 上真实的 socket 中断错误是 Winsock 的 WSAECONNRESET(10054) / WSAECONNABORTED(10053)；
// 而 syscall.ECONNRESET 在 Windows 上是 Go 为 oserror 映射合成的常量（536870935），
// 与 Winsock 错误号不相等。只用 syscall.ECONNRESET 会把所有「连接被强制关闭」漏判成永久失败，
// 表现为上游已提交任务的一次网络抖动让整次轮询失败。
func transportResetErrors() []error {
	return []error{syscall.WSAECONNRESET, syscall.WSAECONNABORTED, syscall.ECONNRESET, syscall.ECONNABORTED, syscall.EPIPE}
}
