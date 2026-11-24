"""Bounded, read-only host sample; private per-mount locks suppress stuck lookups."""
import fcntl
import hashlib
import json
import os
import re
import selectors
import stat
import subprocess
import sys
import time
from pathlib import Path

VIRTUAL = {'proc', 'sysfs', 'devtmpfs', 'tmpfs', 'devfs', 'devpts', 'bpf', 'cgroup', 'cgroup2', 'pstore',
           'securityfs', 'debugfs', 'tracefs', 'configfs', 'fusectl', 'mqueue', 'hugetlbfs',
           'rpc_pipefs', 'binfmt_misc', 'autofs', 'overlay', 'squashfs', 'efivarfs', 'nsfs'}
NETWORK = {'nfs', 'nfs4', 'cifs', 'smbfs', 'smb3', '9p', 'ceph', 'glusterfs'}
WORKER = """import json,os,sys
s=os.statvfs(sys.argv[1]); total=s.f_blocks*s.f_frsize; used=(s.f_blocks-s.f_bfree)*s.f_frsize
available=s.f_bavail*s.f_frsize; denominator=used+available
print(json.dumps({'total':total,'used':used,'percent':100*used/denominator if denominator else 0}),flush=True)
"""


def unescape(value):
    return re.sub(r'\\([0-7]{3})', lambda m: chr(int(m.group(1), 8)), value)


def mounts(text, platform='linux'):
    visible = {}
    for line in text.splitlines():
        if platform == 'darwin':
            match = re.match(r'^(.*?) on (.*?) \(([^,)]+)(?:,.*)?\)$', line)
            if not match:
                continue
            source, target, fs_type = match.groups()
            root, device = '/', source
        else:
            left, separator, right = line.partition(' - ')
            fields, extra = left.split(), right.split()
            if not separator or len(fields) < 6 or len(extra) < 2:
                continue
            device, root, target = fields[2:5]
            fs_type, source = extra[:2]
        target, source, root = map(unescape, (target, source, root))
        if not target.startswith('/') or fs_type in VIRTUAL and target != '/':
            continue
        # Keep distinct exports/binds. Only the last visible record of an exact
        # mount path replaces a previous record; never deduplicate by device ID.
        visible[target] = {'mount': target, 'fsType': fs_type, 'source': source,
                           'root': root, 'device': device,
                           'kind': 'network' if fs_type in NETWORK or fs_type.startswith('fuse.') else 'local'}
    return sorted(visible.values(), key=lambda d: (d['mount'] != '/', d['kind'] == 'network', d['mount']))


def lock_directory(directory):
    try:
        os.mkdir(directory, 0o700)
    except FileExistsError:
        pass
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    info = os.fstat(fd)
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        os.close(fd)
        raise OSError('Unsafe capacity lock directory')
    return fd


def capacities(entries, budget=1.6, directory=None, launch=subprocess.Popen):
    """Parent never waits indefinitely for statfs, even after an ineffective kill."""
    rows = [dict({k: v for k, v in e.items() if k not in ('device', 'root')},
                 total=None, used=None, percent=None, status='unknown', error='Capacity query timed out') for e in entries]
    folder = directory or os.path.join('/tmp', 'claw3d-monitoring-' + str(os.getuid()))
    try:
        lock_dir = lock_directory(folder)
    except OSError:
        for row in rows:
            row['error'] = 'Capacity lookup unavailable'
        return rows
    selector, active, children = selectors.DefaultSelector(), {}, []
    deadline, index = time.monotonic() + budget, 0
    try:
        while time.monotonic() < deadline and (index < len(rows) or active):
            while index < len(rows) and len(active) < 4 and time.monotonic() < deadline:
                row, identity = rows[index], entries[index]
                index += 1
                key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest() + '.lock'
                fd = None
                try:
                    fd = os.open(key, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=lock_dir)
                    if os.fstat(fd).st_uid != os.getuid() or not stat.S_ISREG(os.fstat(fd).st_mode):
                        raise OSError('Unsafe lock')
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    # Only the lock and an independent pipe reach the child. A
                    # kernel-blocked worker cannot hold the SSH output open.
                    child = launch([sys.executable, '-c', WORKER, row['mount']], stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, close_fds=True,
                                   pass_fds=(fd,), start_new_session=True)
                    children.append(child)
                    os.set_blocking(child.stdout.fileno(), False)
                    active[child.stdout.fileno()] = (child, row, bytearray())
                    selector.register(child.stdout, selectors.EVENT_READ)
                except BlockingIOError:
                    row['error'] = 'Previous capacity query still in flight'
                except OSError:
                    row['error'] = 'Capacity lookup unavailable'
                finally:
                    if fd is not None:
                        os.close(fd)
            if not active:
                continue
            for event, _ in selector.select(max(0, deadline - time.monotonic())):
                child, row, data = active[event.fd]
                chunk = os.read(event.fd, 4096)
                data.extend(chunk)
                if b'\n' not in data and chunk and len(data) < 4096:
                    continue
                try:
                    value = json.loads(data)
                    if not all(isinstance(value.get(k), (int, float)) and not isinstance(value.get(k), bool) and
                               0 <= value[k] < float('inf') for k in ('total', 'used', 'percent')):
                        raise ValueError('Invalid capacity')
                    row.update(value, status='ready', error=None)
                    row['percent'] = min(100, row['percent'])
                except (ValueError, TypeError):
                    row['error'] = 'Capacity lookup unavailable'
                selector.unregister(child.stdout)
                del active[event.fd]
                child.stdout.close()
                if child.poll() is None:
                    child.kill()
    finally:
        selector.close()
        os.close(lock_dir)
        for child in children:
            if child.poll() is None:
                child.kill()
            child.stdout.close()
        # poll uses WNOHANG. Never communicate()/wait() after kill on hard NFS.
        reap_until = time.monotonic() + 0.1
        while any(child.poll() is None for child in children) and time.monotonic() < reap_until:
            time.sleep(0.005)
    return rows


def disks():
    try:
        if sys.platform == 'darwin':
            text = subprocess.check_output(['/sbin/mount'], text=True, timeout=0.5)
        else:
            with open('/proc/self/mountinfo') as source:
                text = source.read(1024 * 1024)
        entries = mounts(text, sys.platform)
        return {'disks': capacities(entries[:64]), 'disksError': 'Mount list limited to 64 entries' if len(entries) > 64 else 'Mount list truncated' if len(text) >= 1024 * 1024 else None}
    except (OSError, ValueError, subprocess.SubprocessError):
        return {'disks': [], 'disksError': 'Mount list unavailable'}


def cpu():
    values = [int(n) for n in Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
    return sum(values), values[3] + values[4]


def network():
    values = {}
    for line in Path('/proc/net/dev').read_text().splitlines()[2:]:
        name, raw = line.split(':', 1)
        name = name.strip()
        if name == 'lo' or name.startswith(('veth', 'docker', 'br-', 'virbr')):
            continue
        fields = raw.split()
        values[name] = (int(fields[0]), int(fields[8]))
    return values


def sample():
    first_cpu, first_net, start = cpu(), network(), time.monotonic()
    time.sleep(1)
    second_cpu, second_net, elapsed = cpu(), network(), time.monotonic() - start
    total_delta, idle_delta = second_cpu[0] - first_cpu[0], second_cpu[1] - first_cpu[1]
    mem = {line.split(':')[0]: int(line.split()[1]) * 1024 for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith(('MemTotal:', 'MemAvailable:'))}
    shared = first_net.keys() & second_net.keys()
    total, available = mem.get('MemTotal'), mem.get('MemAvailable')
    return {'cores': os.cpu_count() or 1,
            'cpuPercent': round(max(0, min(100, 100 * (1 - idle_delta / total_delta))), 1) if total_delta > 0 else None,
            'load1': os.getloadavg()[0], 'memoryTotal': total,
            'memoryUsed': max(0, total - available) if total is not None and available is not None else None,
            'rxBytesPerSecond': sum(max(0, second_net[n][0] - first_net[n][0]) for n in shared) / elapsed,
            'txBytesPerSecond': sum(max(0, second_net[n][1] - first_net[n][1]) for n in shared) / elapsed,
            'uptimeSeconds': float(Path('/proc/uptime').read_text().split()[0]), **disks()}


if __name__ == '__main__':
    print(json.dumps(disks() if '--disks-only' in sys.argv else sample(), allow_nan=False))
