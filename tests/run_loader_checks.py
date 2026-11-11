"""Run synthetic application checks using Windows' installed Chakra runtime.

Reads only named JavaScript source files. No browser, sockets, downloads,
spreadsheet files, address records, profiles or external processes are used.
"""
from collections import deque
import ctypes
from ctypes import byref, c_size_t, c_uint, c_ushort, c_void_p, c_wchar_p
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]


def source(name):
    return (ROOT / name).read_text(encoding="utf-8")


def javascript():
    # Bundle actual application source, removing only module declarations.
    # Dynamic entry-point imports are replaced by the production test adapter.
    files = ["src/core.js", "src/analysis-core.js", "src/analysis.js", "src/app.js"]
    code = "\n".join(source(name) for name in files)
    code = re.sub(r"^import\s+[^;]+;\s*", "", code, flags=re.MULTILINE)
    boot = source("src/bootstrap.js").split("// The synthetic test page")[0]
    definitions = re.sub(r"^export\s+", "", code + "\n" + boot, flags=re.MULTILINE)
    tests = []
    for name in ("tests/core.test.js", "tests/analysis.test.js", "tests/building-flow.test.js",
                 "tests/bootstrap.test.js", "tests/markers.test.js"):
        code = re.sub(r"^import\s+[^;]+;\s*", "", source(name), flags=re.MULTILINE)
        tests.append("await (async () => {\n" + code + "\n})();")
    return r"""
var __report = { finished: false, failure: '', nodes: {} };
var globalThis = this;
class AbortController {
  constructor() { this.signal = { aborted: false }; }
  abort() { this.signal.aborted = true; }
}
var document = { documentElement: { dataset: {} }, getElementById: function(id) {
  return __report.nodes[id] || (__report.nodes[id] = { textContent: '' });
} };
// Standard-method shims for this older test runtime; application code is intact.
if (!Promise.allSettled) Promise.allSettled = function(items) {
  return Promise.all(items.map(function(item) { return Promise.resolve(item).then(
    function(value) { return { status: 'fulfilled', value: value }; },
    function(reason) { return { status: 'rejected', reason: reason }; }); }));
};
if (!Array.prototype.flatMap) Array.prototype.flatMap = function(callback) {
  return this.reduce(function(result, item, i) { return result.concat(callback(item, i)); }, []);
};
if (!Object.hasOwn) Object.hasOwn = function(object, key) { return Object.prototype.hasOwnProperty.call(object, key); };
if (!Object.fromEntries) Object.fromEntries = function(entries) {
  var result = {};
  entries.forEach(function(entry) { Object.defineProperty(result, entry[0], { value: entry[1], enumerable: true, configurable: true, writable: true }); });
  return result;
};
// Deterministic timers: the host drains microtasks before advancing this clock.
var __timers = [], __timerId = 0, __clock = 0;
function setTimeout(callback, delay) {
  var id = ++__timerId;
  __timers.push({ id: id, due: __clock + delay, callback: callback });
  return id;
}
function clearTimeout(id) { __timers = __timers.filter(function(timer) { return timer.id !== id; }); }
function __runNextTimer() {
  if (!__timers.length) return false;
  __timers.sort(function(a, b) { return a.due - b.due || a.id - b.id; });
  var timer = __timers.shift(); __clock = timer.due; timer.callback(); return true;
}
""" + definitions + "\n(async () => {\n" + "\n".join(tests) + r"""
__report.results = document.documentElement.dataset;
__report.finished = true;
})().catch(function(error) { __report.failure = String(error); __report.finished = true; });
"""


def main():
    if sys.platform != "win32":
        raise SystemExit("This optional runner requires Windows' installed Chakra.dll.")
    js = ctypes.WinDLL("Chakra.dll")
    signatures = {
        "JsCreateRuntime": [c_uint, c_void_p, ctypes.POINTER(c_void_p)],
        "JsCreateContext": [c_void_p, ctypes.POINTER(c_void_p)],
        "JsSetCurrentContext": [c_void_p],
        "JsRunScript": [c_wchar_p, c_size_t, c_wchar_p, ctypes.POINTER(c_void_p)],
        "JsGetAndClearException": [ctypes.POINTER(c_void_p)],
        "JsConvertValueToString": [c_void_p, ctypes.POINTER(c_void_p)],
        "JsStringToPointer": [c_void_p, ctypes.POINTER(c_wchar_p), ctypes.POINTER(c_size_t)],
        "JsGetUndefinedValue": [ctypes.POINTER(c_void_p)],
        "JsCallFunction": [c_void_p, ctypes.POINTER(c_void_p), c_ushort, ctypes.POINTER(c_void_p)],
        "JsAddRef": [c_void_p, ctypes.POINTER(c_uint)],
        "JsRelease": [c_void_p, ctypes.POINTER(c_uint)],
        "JsDisposeRuntime": [c_void_p],
    }
    for name, args in signatures.items():
        function = getattr(js, name)
        function.argtypes = args
        function.restype = c_uint

    def string(value):
        converted, pointer, size = c_void_p(), c_wchar_p(), c_size_t()
        check(js.JsConvertValueToString(value, byref(converted)))
        check(js.JsStringToPointer(converted, byref(pointer), byref(size)))
        return ctypes.wstring_at(pointer, size.value)

    def check(code):
        if code:
            if code in (0x30001, 0x30002):
                exception = c_void_p()
                if js.JsGetAndClearException(byref(exception)) == 0:
                    raise RuntimeError(string(exception))
            raise RuntimeError(f"JavaScript runtime error: 0x{code:x}")

    def evaluate(code):
        result = c_void_p()
        check(js.JsRunScript(code, 0, "synthetic-loader-checks.js", byref(result)))
        return result

    runtime, context, undefined = c_void_p(), c_void_p(), c_void_p()
    check(js.JsCreateRuntime(0, None, byref(runtime)))
    try:
        check(js.JsCreateContext(runtime, byref(context)))
        check(js.JsSetCurrentContext(context))
        queue = deque()
        callback_type = ctypes.WINFUNCTYPE(None, c_void_p, c_void_p)

        @callback_type
        def continuation(task, _state):
            js.JsAddRef(task, None)
            queue.append(task)

        js.JsSetPromiseContinuationCallback.argtypes = [callback_type, c_void_p]
        check(js.JsSetPromiseContinuationCallback(continuation, None))
        check(js.JsGetUndefinedValue(byref(undefined)))
        arguments = (c_void_p * 1)(undefined.value)
        evaluate(javascript())
        for _ in range(10000):
            if queue:
                task = queue.popleft()
                try:
                    check(js.JsCallFunction(task, arguments, 1, None))
                finally:
                    js.JsRelease(task, None)
                continue
            if string(evaluate("String(__report.finished)")) == "true":
                break
            if string(evaluate("String(__runNextTimer())")) == "false":
                raise RuntimeError("Synthetic checks stalled without queued jobs or timers")
        else:
            raise RuntimeError("Synthetic checks exceeded the job limit")
        report = json.loads(string(evaluate("JSON.stringify(__report)")))
        for name in ("results", "analysis-results", "building-flow-results", "bootstrap-results", "markers-results"):
            print(report["nodes"].get(name, {}).get("textContent", "NO RESULT: " + name))
        if report["failure"]:
            raise RuntimeError(report["failure"])
        if any(report.get("results", {}).get(name) != "passed" for name in
               ("testResult", "analysisTestResult", "buildingFlowTestResult", "bootstrapTestResult", "markersTestResult")):
            raise SystemExit(1)
    finally:
        js.JsSetCurrentContext(None)
        js.JsDisposeRuntime(runtime)


if __name__ == "__main__":
    main()
