package outbound

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/kernel"
)

func TestOutboundDNSFailurePreservesCauseWithoutExposingHost(t *testing.T) {
	previous := net.DefaultResolver
	net.DefaultResolver = &net.Resolver{PreferGo: true, Dial: func(context.Context, string, string) (net.Conn, error) {
		return nil, errors.New("private-sentinel DNS transport unavailable")
	}}
	t.Cleanup(func() { net.DefaultResolver = previous })

	for _, validate := range []func(string) error{ValidateOutboundHost, validateCustomRelayHost} {
		err := validate("private-sentinel.invalid")
		var appErr *kernel.AppError
		var dnsErr *net.DNSError
		if !errors.As(err, &appErr) || appErr.Status != http.StatusBadGateway || appErr.Reason != kernel.ReasonUpstreamDNSFailed || appErr.Retryable {
			t.Fatalf("incorrect DNS failure classification: %#v", err)
		}
		if !errors.As(err, &dnsErr) {
			t.Fatal("DNS cause was discarded")
		}
		if strings.Contains(err.Error(), "private-sentinel") {
			t.Fatal("DNS details leaked into safe message")
		}
	}
	// Invalid destinations remain policy failures, never DNS/network failures.
	for _, host := range []string{"", "localhost", "127.0.0.1", "10.0.0.1"} {
		_, err := resolveOutboundHostWithPolicy(context.Background(), host, false)
		var badRequest *BadRequestError
		if !errors.As(err, &badRequest) {
			t.Fatalf("SSRF validation weakened for %q: %v", host, err)
		}
	}
}

func TestOutboundDNSCancellationKeepsCancellationSemantics(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := resolveOutboundHostWithPolicy(ctx, "cancelled.invalid", false)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation became a DNS failure: %v", err)
	}
}

// 短剧会并发提交几十个任务，同一域名在窗口内只该解析一次。
func TestLookupOutboundIPReusesRecentResult(t *testing.T) {
	resetOutboundDNSCache(t)
	calls := 0
	previous := outboundLookupIP
	outboundLookupIP = func(context.Context, string) ([]net.IP, error) {
		calls++
		return []net.IP{net.ParseIP("93.184.216.34")}, nil
	}
	t.Cleanup(func() {
		outboundLookupIP = previous
		resetOutboundDNSCache(t)
	})

	for index := 0; index < 5; index++ {
		if _, err := lookupOutboundIP(context.Background(), "cache-hit.test"); err != nil {
			t.Fatal(err)
		}
	}
	if calls != 1 {
		t.Fatalf("resolver called %d times within TTL, want 1", calls)
	}
}

// 解析失败可能是瞬时抖动，缓存它会让一次抖动固化成一整段时间不可用。
func TestLookupOutboundIPDoesNotCacheFailure(t *testing.T) {
	resetOutboundDNSCache(t)
	calls := 0
	shouldFail := true
	previous := outboundLookupIP
	outboundLookupIP = func(context.Context, string) ([]net.IP, error) {
		calls++
		if shouldFail {
			return nil, &net.DNSError{Err: "transient", IsTimeout: true}
		}
		return []net.IP{net.ParseIP("93.184.216.34")}, nil
	}
	t.Cleanup(func() {
		outboundLookupIP = previous
		resetOutboundDNSCache(t)
	})

	if _, err := lookupOutboundIP(context.Background(), "cache-miss.test"); err == nil {
		t.Fatal("expected failure")
	}
	shouldFail = false
	if _, err := lookupOutboundIP(context.Background(), "cache-miss.test"); err != nil {
		t.Fatalf("retry after transient failure must resolve again: %v", err)
	}
	if calls != 2 {
		t.Fatalf("resolver called %d times, want 2", calls)
	}
}

// 过期后必须重新解析，否则域名切换 IP 会一直连旧地址。
func TestLookupOutboundIPRefreshesAfterExpiry(t *testing.T) {
	resetOutboundDNSCache(t)
	calls := 0
	previous := outboundLookupIP
	outboundLookupIP = func(context.Context, string) ([]net.IP, error) {
		calls++
		return []net.IP{net.ParseIP("93.184.216.34")}, nil
	}
	t.Cleanup(func() {
		outboundLookupIP = previous
		resetOutboundDNSCache(t)
	})

	if _, err := lookupOutboundIP(context.Background(), "cache-expiry.test"); err != nil {
		t.Fatal(err)
	}
	outboundDNSCacheMu.Lock()
	entry := outboundDNSCache["cache-expiry.test"]
	entry.expiresAt = time.Now().Add(-time.Second)
	outboundDNSCache["cache-expiry.test"] = entry
	outboundDNSCacheMu.Unlock()

	if _, err := lookupOutboundIP(context.Background(), "cache-expiry.test"); err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatalf("expired entry must be refreshed, resolver called %d times", calls)
	}
}

func resetOutboundDNSCache(t *testing.T) {
	t.Helper()
	outboundDNSCacheMu.Lock()
	outboundDNSCache = map[string]outboundDNSEntry{}
	outboundDNSCacheMu.Unlock()
}
