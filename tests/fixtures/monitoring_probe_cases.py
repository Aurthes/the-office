"""Synthetic statfs isolation tests. Never contacts a network mount."""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('probe', sys.argv.pop(1))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

MOUNTS = '''1 0 8:2 / / rw - ext4 /dev/sda2 rw
2 1 8:17 / /mnt/data rw - ext4 /dev/sdb1 rw
3 1 0:56 / /srv/nfs/data rw - nfs4 host:/hf_data rw
4 1 0:56 / /srv/nfs/tasks rw - nfs4 host:/hf_task rw
5 1 0:56 / /srv/nfs/shared rw - nfs4 host:/user_storage rw
6 1 0:1 / /proc rw - proc proc rw
10 1 0:2 / /dev/pts rw - devpts devpts rw
11 1 0:3 / /sys/fs/bpf rw - bpf bpf rw
'''


class FakeProcess:
    def __init__(self, stuck, lock_fd):
        self.lock = os.dup(lock_fd)
        read_fd, self.writer = os.pipe()
        self.stdout = os.fdopen(read_fd, 'rb', buffering=0)
        self.stuck = stuck
        if not stuck:
            os.write(self.writer, json.dumps({'total': 100, 'used': 25, 'percent': 25}).encode() + b'\n')
            os.close(self.writer)
            os.close(self.lock)

    def kill(self):
        pass  # Deliberately ignores kill, representing an uninterruptible lookup.

    def poll(self):
        return None if self.stuck else 0

    def wait(self, *args, **kwargs):
        raise AssertionError('Parent waited for an uninterruptible query')

    communicate = wait

    def release(self):
        if self.stuck:
            os.close(self.writer)
            os.close(self.lock)
            self.stuck = False


class ProbeTests(unittest.TestCase):
    def test_distinct_exports_and_visible_mounts(self):
        rows = probe.mounts(MOUNTS)
        self.assertEqual([r['mount'] for r in rows], ['/', '/mnt/data', '/srv/nfs/data', '/srv/nfs/tasks', '/srv/nfs/shared'])
        self.assertEqual(len([r for r in rows if r['kind'] == 'network']), 3)
        self.assertEqual(probe.unescape(r'/a\011b\134c'), '/a\tb\\c')
        extra = '7 1 8:17 / /mnt/with\\040space rw - ext4 /dev/sdb1 rw\n8 7 8:18 / /mnt/with\\040space rw - xfs /dev/new rw\n'
        self.assertEqual(probe.mounts(extra)[0]['source'], '/dev/new')
        self.assertEqual(probe.mounts(extra)[0]['mount'], '/mnt/with space')
        self.assertEqual(len(probe.mounts(MOUNTS + '9 1 8:17 / /bind rw - ext4 /dev/sdb1 rw')), 6)
        self.assertEqual(probe.mounts('1 0 0:1 / / rw - overlay overlay rw')[0]['mount'], '/')

    def test_deadline_ignores_unkillable_child_and_lock_blocks_next_probe(self):
        children, started = [], []
        def launch(argv, **kwargs):
            self.assertTrue(kwargs['close_fds'])
            self.assertTrue(kwargs['start_new_session'])
            self.assertEqual(kwargs['stderr'], subprocess.DEVNULL)
            self.assertEqual(kwargs['stdin'], subprocess.DEVNULL)
            started.append(argv[-1])
            child = FakeProcess(argv[-1] == '/srv/nfs/data', kwargs['pass_fds'][0])
            children.append(child)
            return child
        with tempfile.TemporaryDirectory() as root:
            try:
                entries = probe.mounts(MOUNTS)
                start = time.monotonic()
                one = probe.capacities(entries, budget=0.04, directory=root + '/locks', launch=launch)
                self.assertLess(time.monotonic() - start, 0.4)
                self.assertEqual([r['status'] for r in one], ['ready', 'ready', 'unknown', 'ready', 'ready'])
                two = probe.capacities(entries, budget=0.04, directory=root + '/locks', launch=launch)
                self.assertEqual(two[2]['error'], 'Previous capacity query still in flight')
                self.assertEqual(started.count('/srv/nfs/data'), 1)
                self.assertEqual(two[2]['mount'], '/srv/nfs/data')
                self.assertIsNone(two[2]['percent'])
                self.assertTrue(all(r['status'] == 'ready' for r in two if r['mount'] != '/srv/nfs/data'))
            finally:
                for child in children:
                    child.release()

    def test_real_local_statfs_child_and_private_lock_files(self):
        with tempfile.TemporaryDirectory() as root:
            entries = [{'mount': root, 'fsType': 'fixture', 'source': 'local', 'root': '/', 'device': 'fixture', 'kind': 'local'}]
            rows = probe.capacities(entries, directory=root + '/locks')
            self.assertEqual(rows[0]['status'], 'ready')
            self.assertGreater(rows[0]['total'], 0)
            self.assertEqual(os.stat(root + '/locks').st_mode & 0o777, 0o700)
            self.assertTrue(all(os.stat(root + '/locks/' + f).st_mode & 0o777 == 0o600 for f in os.listdir(root + '/locks')))

    def test_real_child_inherits_lock_across_a_returning_parent_probe(self):
        children = []
        def launch(argv, **kwargs):
            child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(10)'], **kwargs)
            children.append((child, child.kill))
            child.kill = lambda: None  # Simulate a kernel wait without a real NFS fault.
            return child
        with tempfile.TemporaryDirectory() as root:
            entries = probe.mounts(MOUNTS)[:1]
            try:
                first = probe.capacities(entries, budget=0.03, directory=root + '/locks', launch=launch)
                self.assertEqual(first[0]['status'], 'unknown')
                second = probe.capacities(entries, budget=0.03, directory=root + '/locks', launch=launch)
                self.assertEqual(second[0]['error'], 'Previous capacity query still in flight')
                self.assertEqual(len(children), 1)
            finally:
                for child, kill in children:
                    kill()
                    child.wait(timeout=2)

    def test_symlink_lock_directory_never_starts_a_child(self):
        with tempfile.TemporaryDirectory() as root:
            os.mkdir(root + '/real')
            os.symlink(root + '/real', root + '/link')
            with patch.object(probe.subprocess, 'Popen') as launch:
                rows = probe.capacities(probe.mounts(MOUNTS), directory=root + '/link', launch=launch)
                launch.assert_not_called()
                self.assertTrue(all(r['status'] == 'unknown' for r in rows))

    def test_core_sample_survives_unknown_mount_capacity(self):
        class ProcFile:
            def __init__(self, name): self.name = name
            def read_text(self): return 'MemTotal: 100 kB\nMemAvailable: 40 kB\n' if self.name.endswith('meminfo') else '20 0'
        unknown = {'disks': [{'mount': '/nfs', 'fsType': 'nfs4', 'total': None, 'used': None, 'percent': None, 'status': 'unknown'}]}
        with patch.object(probe, 'cpu', side_effect=[(100, 30), (200, 50)]), patch.object(probe, 'network', return_value={'eth0': (1, 2)}), patch.object(probe, 'Path', ProcFile), patch.object(probe.time, 'sleep'), patch.object(probe.time, 'monotonic', side_effect=[0, 1]), patch.object(probe, 'disks', return_value=unknown):
            result = probe.sample()
        self.assertEqual(result['cpuPercent'], 80)
        self.assertEqual(result['memoryUsed'], 60 * 1024)
        self.assertEqual(result['disks'][0]['status'], 'unknown')
        self.assertEqual(result['rxBytesPerSecond'], 0)

    def test_failed_mount_inventory_and_mac_metadata(self):
        with patch.object(probe.sys, 'platform', 'linux'), patch.object(probe, 'open', side_effect=OSError()):
            self.assertEqual(probe.disks(), {'disks': [], 'disksError': 'Mount list unavailable'})
        rows = probe.mounts('/dev/disk1 on / (apfs, local, read-only)\nhost:/data on /Volumes/Data Share (nfs)\ndevfs on /dev (devfs, local)', 'darwin')
        self.assertEqual([(r['mount'], r['fsType']) for r in rows], [('/', 'apfs'), ('/Volumes/Data Share', 'nfs')])


unittest.main()
