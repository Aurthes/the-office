"""One bounded Linux host sample. Reads only; installs and writes nothing."""
import json
import os
import subprocess
import time
from pathlib import Path


def cpu():
    # guest and guest_nice are already included in user and nice.
    values = [int(n) for n in Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
    return sum(values), values[3] + values[4]


def network():
    values = {}
    for line in Path('/proc/net/dev').read_text().splitlines()[2:]:
        name, raw = line.split(':', 1)
        name = name.strip()
        # Avoid counting the same traffic again on bridges and virtual NICs.
        if name == 'lo' or name.startswith(('veth', 'docker', 'br-', 'virbr')):
            continue
        fields = raw.split()
        values[name] = (int(fields[0]), int(fields[8]))
    return values


first_cpu, first_net, start = cpu(), network(), time.monotonic()
time.sleep(1)
second_cpu, second_net, elapsed = cpu(), network(), time.monotonic() - start
total_delta = second_cpu[0] - first_cpu[0]
idle_delta = second_cpu[1] - first_cpu[1]
mem = {line.split(':')[0]: int(line.split()[1]) * 1024 for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith(('MemTotal:', 'MemAvailable:'))}
disks = []
try:
    # Local filesystems only: a stalled network mount must not stall monitoring.
    output = subprocess.check_output(['df', '-P', '-B1', '-l', '-x', 'tmpfs', '-x', 'devtmpfs', '-x', 'squashfs', '-x', 'efivarfs'], timeout=2, text=True)
    seen = set()
    for line in output.splitlines()[1:]:
        fields = line.split(None, 5)
        if len(fields) != 6 or fields[0] in seen:
            continue
        seen.add(fields[0])
        disks.append({'mount': fields[5], 'total': int(fields[1]), 'used': int(fields[2]), 'percent': float(fields[4].rstrip('%'))})
except (OSError, ValueError, subprocess.SubprocessError):
    pass

shared = first_net.keys() & second_net.keys()
rx = sum(max(0, second_net[n][0] - first_net[n][0]) for n in shared) / elapsed
tx = sum(max(0, second_net[n][1] - first_net[n][1]) for n in shared) / elapsed
memory_total, memory_available = mem.get('MemTotal'), mem.get('MemAvailable')
print(json.dumps({
    'cores': os.cpu_count() or 1,
    'cpuPercent': round(max(0, min(100, 100 * (1 - idle_delta / total_delta))), 1) if total_delta > 0 else None,
    'load1': os.getloadavg()[0],
    'memoryTotal': memory_total,
    'memoryUsed': max(0, memory_total - memory_available) if memory_total is not None and memory_available is not None else None,
    'disks': disks,
    'rxBytesPerSecond': rx,
    'txBytesPerSecond': tx,
    'uptimeSeconds': float(Path('/proc/uptime').read_text().split()[0]),
}, allow_nan=False))
