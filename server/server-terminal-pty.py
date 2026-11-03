"""A disposable terminal PTY. Only the server supplies the executable/arguments."""
import base64
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios
import time


def emit(value):
    print(json.dumps(value), flush=True)


def terminate(_signum, _frame):
    raise SystemExit(0)


signal.signal(signal.SIGTERM, terminate)
pid, master = pty.fork()
if pid == 0:
    os.execvp(sys.argv[1], sys.argv[1:])

pending = b""
try:
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
    while True:
        readable, _, _ = select.select([master, sys.stdin.buffer], [], [], .2)
        if master in readable:
            try:
                data = os.read(master, 4096)
            except OSError:
                data = b""
            if data:
                emit({"dataBase64": base64.b64encode(data).decode("ascii")})
            else:
                _, status = os.waitpid(pid, 0)
                pid = 0
                emit({"exitCode": os.waitstatus_to_exitcode(status)})
                break
        if sys.stdin.buffer in readable:
            data = os.read(sys.stdin.fileno(), 32768)
            if not data:
                break
            pending += data
            while b"\n" in pending:
                line, pending = pending.split(b"\n", 1)
                command = json.loads(line)
                if command["type"] == "write":
                    data = base64.b64decode(command["dataBase64"], validate=True)
                    while data:
                        size = os.write(master, data)
                        data = data[size:]
                elif command["type"] == "resize":
                    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", command["rows"], command["cols"], 0, 0))
                elif command["type"] == "stop":
                    raise SystemExit(0)
finally:
    os.close(master)
    if pid:
        try:
            os.killpg(pid, signal.SIGHUP)
            deadline = time.monotonic() + 1
            while time.monotonic() < deadline:
                if os.waitpid(pid, os.WNOHANG)[0]:
                    pid = 0
                    break
                time.sleep(.02)
            if pid:
                os.killpg(pid, signal.SIGKILL)
                os.waitpid(pid, 0)
        except (ProcessLookupError, ChildProcessError):
            pass
