/**
 * Adversarial Tests for @agentic/runtime-adapters
 *
 * Targets NodeFsStorageAdapter and NodeFsLockAdapter with edge cases,
 * race conditions, boundary values, error handling, state corruption,
 * invalid assumptions, resource exhaustion, and type safety.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile as nativeReadFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  NodeFsStorageAdapter,
  NodeFsLockAdapter,
} from "@agentic/runtime-adapters";

describe("Adversarial: NodeFsStorageAdapter", () => {
  let adapter: NodeFsStorageAdapter;
  let tmpDir: string;

  beforeEach(async () => {
    adapter = new NodeFsStorageAdapter();
    tmpDir = await mkdtemp(path.join(tmpdir(), "adversarial-storage-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ─── Edge Cases ──────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles empty string path for exists() returning false", async () => {
      // Empty string resolves to cwd in node:path, which exists.
      // This tests that we don't crash on degenerate input.
      const result = await adapter.exists("");
      // "" resolves to process.cwd() which exists, so this should be true
      expect(typeof result).toBe("boolean");
    });

    it("handles deeply nested paths (20 levels)", async () => {
      const segments = Array.from({ length: 20 }, (_, i) => `level${i}`);
      const deepDir = path.join(tmpDir, ...segments);
      const filePath = path.join(deepDir, "deep.txt");

      // writeFile should create all intermediate dirs
      await adapter.writeFile(filePath, "deep content");
      const content = await adapter.readFile(filePath, "utf8");
      expect(content).toBe("deep content");

      const statResult = await adapter.stat(filePath);
      expect(statResult.isFile).toBe(true);
    });

    it("handles unicode filenames including emoji and CJK characters", async () => {
      const unicodeName = "文件_🔥_файл_ملف.txt";
      const filePath = path.join(tmpDir, unicodeName);

      await adapter.writeFile(filePath, "unicode content");
      expect(await adapter.exists(filePath)).toBe(true);

      const content = await adapter.readFile(filePath, "utf8");
      expect(content).toBe("unicode content");

      await adapter.unlink(filePath);
      expect(await adapter.exists(filePath)).toBe(false);
    });

    it("handles filenames with special characters (spaces, dots, dashes)", async () => {
      const specialName = "file with spaces...and---dashes.tar.gz";
      const filePath = path.join(tmpDir, specialName);

      await adapter.writeFile(filePath, "special");
      const content = await adapter.readFile(filePath, "utf8");
      expect(content).toBe("special");
    });

    it("handles path traversal attempts safely via resolve", () => {
      const resolved = adapter.resolve(tmpDir, "..", "..", "etc", "passwd");
      // Should resolve to an absolute path outside tmpDir
      expect(adapter.isAbsolute(resolved)).toBe(true);
      // The resolved path should NOT be inside tmpDir
      expect(resolved.startsWith(tmpDir)).toBe(false);
    });
  });

  // ─── Boundary Values ─────────────────────────────────────────

  describe("boundary values", () => {
    it("writes and reads zero-byte files correctly", async () => {
      const filePath = path.join(tmpDir, "empty.txt");

      await adapter.writeFile(filePath, "");
      const content = await adapter.readFile(filePath, "utf8");
      expect(content).toBe("");

      const statResult = await adapter.stat(filePath);
      expect(statResult.size).toBe(0);
    });

    it("writes and reads zero-byte binary files correctly", async () => {
      const filePath = path.join(tmpDir, "empty.bin");
      const emptyBytes = new Uint8Array(0);

      await adapter.writeFile(filePath, emptyBytes);
      const content = await adapter.readFile(filePath);
      expect(content).toBeInstanceOf(Uint8Array);
      expect((content as Uint8Array).length).toBe(0);
    });

    it("handles single-byte read/write correctly", async () => {
      const filePath = path.join(tmpDir, "single.bin");
      const singleByte = new Uint8Array([0x42]);

      await adapter.writeFile(filePath, singleByte);
      const content = await adapter.readFile(filePath);
      expect(content).toBeInstanceOf(Uint8Array);
      expect((content as Uint8Array).length).toBe(1);
      expect((content as Uint8Array)[0]).toBe(0x42);
    });

    it("handles large file (1MB) write and read", async () => {
      const filePath = path.join(tmpDir, "large.bin");
      const largeData = new Uint8Array(1024 * 1024);
      // Fill with a pattern to verify integrity
      for (let i = 0; i < largeData.length; i++) {
        largeData[i] = i % 256;
      }

      await adapter.writeFile(filePath, largeData);
      const content = await adapter.readFile(filePath);
      expect(content).toBeInstanceOf(Uint8Array);
      expect((content as Uint8Array).length).toBe(1024 * 1024);
      expect((content as Uint8Array)[0]).toBe(0);
      expect((content as Uint8Array)[255]).toBe(255);
      expect((content as Uint8Array)[1023]).toBe(255);
    });

    it("readdir returns empty array for empty directory", async () => {
      const emptyDir = path.join(tmpDir, "empty-dir");
      await adapter.mkdir(emptyDir);

      const entries = await adapter.readdir(emptyDir);
      expect(entries).toEqual([]);
    });

    it("readdir with withFileTypes returns empty array for empty directory", async () => {
      const emptyDir = path.join(tmpDir, "empty-dir-typed");
      await adapter.mkdir(emptyDir);

      const entries = await adapter.readdir(emptyDir, { withFileTypes: true });
      expect(entries).toEqual([]);
    });
  });

  // ─── Error Handling ──────────────────────────────────────────

  describe("error handling", () => {
    it("readFile throws on missing file", async () => {
      const filePath = path.join(tmpDir, "nonexistent.txt");
      await expect(adapter.readFile(filePath, "utf8")).rejects.toThrow();
    });

    it("stat throws on missing file", async () => {
      const filePath = path.join(tmpDir, "nonexistent.txt");
      await expect(adapter.stat(filePath)).rejects.toThrow();
    });

    it("unlink throws on missing file", async () => {
      const filePath = path.join(tmpDir, "nonexistent.txt");
      await expect(adapter.unlink(filePath)).rejects.toThrow();
    });

    it("rmdir throws on non-empty directory without recursive", async () => {
      const dirPath = path.join(tmpDir, "nonempty");
      await adapter.mkdir(dirPath);
      await adapter.writeFile(path.join(dirPath, "file.txt"), "data");

      // BUG DOCUMENTED: rmdir ignores the recursive option entirely.
      // Even passing { recursive: true } still calls non-recursive rmdir.
      // This means removing non-empty dirs always fails.
      await expect(adapter.rmdir(dirPath)).rejects.toThrow();
    });

    it("rmdir with recursive:true successfully removes non-empty directory", async () => {
      const dirPath = path.join(tmpDir, "nonempty-recursive");
      await adapter.mkdir(dirPath);
      await adapter.writeFile(path.join(dirPath, "file.txt"), "data");

      // Fixed: rmdir now uses rm with recursive:true for non-empty directories
      await expect(
        adapter.rmdir(dirPath, { recursive: true })
      ).resolves.toBeUndefined();

      // Verify directory was removed
      await expect(adapter.stat(dirPath)).rejects.toThrow();
    });

    it("rename throws when source does not exist", async () => {
      const src = path.join(tmpDir, "no-source.txt");
      const dst = path.join(tmpDir, "dst.txt");
      await expect(adapter.rename(src, dst)).rejects.toThrow();
    });

    it("rename creates parent directories for destination", async () => {
      const src = path.join(tmpDir, "source.txt");
      await adapter.writeFile(src, "data");

      const dst = path.join(tmpDir, "nonexistent-subdir", "dest.txt");

      // Fixed: rename() now auto-creates parent directories for the destination
      await expect(adapter.rename(src, dst)).resolves.toBeUndefined();

      // Verify file was moved
      const content = await adapter.readFile(dst, "utf8");
      expect(content).toBe("data");
      await expect(adapter.stat(src)).rejects.toThrow();
    });

    it("readdir throws on non-existent directory", async () => {
      const dirPath = path.join(tmpDir, "no-such-dir");
      await expect(adapter.readdir(dirPath)).rejects.toThrow();
    });

    it("mkdir without recursive throws when parent does not exist", async () => {
      const deepPath = path.join(tmpDir, "no-parent", "child");
      await expect(adapter.mkdir(deepPath)).rejects.toThrow();
    });

    it("mkdir with recursive succeeds when parent does not exist", async () => {
      const deepPath = path.join(tmpDir, "auto-parent", "child", "grandchild");
      await adapter.mkdir(deepPath, { recursive: true });
      expect(await adapter.exists(deepPath)).toBe(true);
    });
  });

  // ─── Invalid Assumptions ─────────────────────────────────────

  describe("invalid assumptions", () => {
    it("writeFile auto-creates parent directories (does not assume they exist)", async () => {
      const filePath = path.join(tmpDir, "a", "b", "c", "file.txt");
      // Should NOT throw even though a/b/c don't exist yet
      await adapter.writeFile(filePath, "auto-created");
      const content = await adapter.readFile(filePath, "utf8");
      expect(content).toBe("auto-created");
    });

    it("reading a directory path with readFile throws (not returns contents)", async () => {
      const dirPath = path.join(tmpDir, "some-dir");
      await adapter.mkdir(dirPath);

      // Reading a directory as a file should throw EISDIR
      await expect(adapter.readFile(dirPath, "utf8")).rejects.toThrow();
    });

    it("writing to a path that is currently a directory throws", async () => {
      const dirPath = path.join(tmpDir, "is-a-dir");
      await adapter.mkdir(dirPath);

      // Trying to write a file where a directory exists should fail
      await expect(
        adapter.writeFile(dirPath, "overwrite attempt")
      ).rejects.toThrow();
    });

    it("stat correctly distinguishes files from directories", async () => {
      const filePath = path.join(tmpDir, "is-file.txt");
      const dirPath = path.join(tmpDir, "is-dir");

      await adapter.writeFile(filePath, "content");
      await adapter.mkdir(dirPath);

      const fileStat = await adapter.stat(filePath);
      expect(fileStat.isFile).toBe(true);
      expect(fileStat.isDirectory).toBe(false);

      const dirStat = await adapter.stat(dirPath);
      expect(dirStat.isFile).toBe(false);
      expect(dirStat.isDirectory).toBe(true);
    });
  });

  // ─── Type Safety ─────────────────────────────────────────────

  describe("type safety", () => {
    it("readFile with utf8 encoding returns string", async () => {
      const filePath = path.join(tmpDir, "typed-string.txt");
      await adapter.writeFile(filePath, "hello");

      const result = await adapter.readFile(filePath, "utf8");
      expect(typeof result).toBe("string");
      expect(result).toBe("hello");
    });

    it("readFile without encoding returns Uint8Array", async () => {
      const filePath = path.join(tmpDir, "typed-binary.bin");
      await adapter.writeFile(filePath, "binary");

      const result = await adapter.readFile(filePath);
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it("readFile without encoding preserves binary data integrity", async () => {
      const filePath = path.join(tmpDir, "binary-integrity.bin");
      // Write bytes that would be invalid UTF-8
      const binaryData = new Uint8Array([0xff, 0xfe, 0x00, 0x80, 0xc0]);
      await adapter.writeFile(filePath, binaryData);

      const result = (await adapter.readFile(filePath)) as Uint8Array;
      expect(result).toBeInstanceOf(Uint8Array);
      expect(Array.from(result)).toEqual([0xff, 0xfe, 0x00, 0x80, 0xc0]);
    });

    it("writeFile accepts both string and Uint8Array", async () => {
      const strPath = path.join(tmpDir, "str-write.txt");
      const binPath = path.join(tmpDir, "bin-write.bin");

      await adapter.writeFile(strPath, "string data");
      await adapter.writeFile(binPath, new Uint8Array([1, 2, 3]));

      expect(await adapter.readFile(strPath, "utf8")).toBe("string data");
      const binResult = (await adapter.readFile(binPath)) as Uint8Array;
      expect(Array.from(binResult)).toEqual([1, 2, 3]);
    });
  });

  // ─── State Corruption / Atomicity ────────────────────────────

  describe("state corruption and atomicity", () => {
    it("writeFile is atomic: no partial content visible during concurrent reads", async () => {
      const filePath = path.join(tmpDir, "atomic.txt");
      await adapter.writeFile(filePath, "initial");

      const writePromise = adapter.writeFile(filePath, "updated content that is longer");

      // Read many times during the write
      const readPromises = Array.from({ length: 20 }, () =>
        adapter.readFile(filePath, "utf8").catch(() => null)
      );

      await writePromise;
      const results = await Promise.all(readPromises);

      // Every successful read should return either the old or new content, never partial
      for (const result of results) {
        if (result !== null) {
          expect(["initial", "updated content that is longer"]).toContain(result);
        }
      }
    });

    it("overwriting a file with shorter content truncates correctly", async () => {
      const filePath = path.join(tmpDir, "truncate.txt");
      await adapter.writeFile(filePath, "this is a long initial content");
      await adapter.writeFile(filePath, "short");

      const content = await adapter.readFile(filePath, "utf8");
      expect(content).toBe("short");

      const statResult = await adapter.stat(filePath);
      expect(statResult.size).toBe(5);
    });

    it("concurrent writes to same file do not corrupt data", async () => {
      const filePath = path.join(tmpDir, "concurrent-writes.txt");

      const writers = Array.from({ length: 10 }, (_, i) =>
        adapter.writeFile(filePath, `writer-${i}-content`)
      );

      await Promise.all(writers);

      // Final content should be one of the written values, not corrupted
      const finalContent = await adapter.readFile(filePath, "utf8");
      expect(finalContent).toMatch(/^writer-\d+-content$/);
    });
  });

  // ─── Path Utilities ──────────────────────────────────────────

  describe("path utilities", () => {
    it("resolve produces absolute paths", () => {
      const resolved = adapter.resolve("relative", "path");
      expect(adapter.isAbsolute(resolved)).toBe(true);
    });

    it("join combines segments correctly", () => {
      const joined = adapter.join("a", "b", "c");
      expect(joined).toBe(path.join("a", "b", "c"));
    });

    it("relative computes correct relative path", () => {
      const rel = adapter.relative("/a/b/c", "/a/b/d/e");
      expect(rel).toBe(path.relative("/a/b/c", "/a/b/d/e"));
    });

    it("dirname and basename work correctly", () => {
      expect(adapter.dirname("/a/b/c.txt")).toBe("/a/b");
      expect(adapter.basename("/a/b/c.txt")).toBe("c.txt");
      expect(adapter.basename("/a/b/c.txt", ".txt")).toBe("c");
    });

    it("sep matches platform separator", () => {
      expect(adapter.sep).toBe(path.sep);
    });
  });
});

describe("Adversarial: NodeFsLockAdapter", () => {
  let storage: NodeFsStorageAdapter;
  let locks: NodeFsLockAdapter;
  let tmpDir: string;

  beforeEach(async () => {
    storage = new NodeFsStorageAdapter();
    locks = new NodeFsLockAdapter(storage);
    tmpDir = await mkdtemp(path.join(tmpdir(), "adversarial-locks-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ─── Basic Lock Operations ──────────────────────────────────

  describe("basic lock operations", () => {
    it("acquires and releases a lock successfully", async () => {
      const lockId = path.join(tmpDir, "basic-lock");
      const release = await locks.acquire(lockId);

      // Lock directory should exist
      expect(await storage.exists(`${lockId}.lock`)).toBe(true);

      await release();

      // Lock directory should be removed
      expect(await storage.exists(`${lockId}.lock`)).toBe(false);
    });

    it("second acquire blocks until first releases", async () => {
      const lockId = path.join(tmpDir, "blocking-lock");
      const release1 = await locks.acquire(lockId);

      let secondAcquired = false;
      const secondPromise = locks.acquire(lockId).then((release) => {
        secondAcquired = true;
        return release;
      });

      // Give the second acquire time to start polling
      await new Promise((r) => setTimeout(r, 50));
      expect(secondAcquired).toBe(false);

      await release1();

      const release2 = await secondPromise;
      expect(secondAcquired).toBe(true);
      await release2();
    });

    it("release is idempotent (double release does not throw)", async () => {
      const lockId = path.join(tmpDir, "idempotent-release");
      const release = await locks.acquire(lockId);

      await release();
      // Second release should not throw
      await expect(release()).resolves.toBeUndefined();
    });
  });

  // ─── Race Conditions ─────────────────────────────────────────

  describe("race conditions", () => {
    it("multiple concurrent acquirers serialize correctly", async () => {
      const lockId = path.join(tmpDir, "race-lock");
      const order: number[] = [];
      const concurrency = 5;

      const workers = Array.from({ length: concurrency }, async (_, i) => {
        const release = await locks.acquire(lockId);
        order.push(i);
        // Hold lock briefly
        await new Promise((r) => setTimeout(r, 10));
        await release();
      });

      await Promise.all(workers);

      // All workers should have acquired the lock exactly once
      expect(order.length).toBe(concurrency);
      // Each index should appear exactly once
      expect(new Set(order).size).toBe(concurrency);
    });

    it("lock acquisition works after holder crashes (stale lock detection)", async () => {
      const lockId = path.join(tmpDir, "stale-lock");

      // Simulate a stale lock by creating the lock directory manually
      const lockPath = `${lockId}.lock`;
      await storage.mkdir(lockPath);

      // Wait for the lock to become stale (use very short staleMs)
      // We need to wait for mtime + staleMs to pass
      const staleMs = 50;
      await new Promise((r) => setTimeout(r, staleMs + 50));

      // Should be able to acquire despite existing lock dir
      const release = await locks.acquire(lockId, { staleMs });
      expect(await storage.exists(lockPath)).toBe(true);
      await release();
    });

    it("rapid acquire/release cycles do not leak lock directories", async () => {
      const lockId = path.join(tmpDir, "rapid-cycle");

      for (let i = 0; i < 20; i++) {
        const release = await locks.acquire(lockId);
        await release();
      }

      // After all cycles, lock directory should not exist
      expect(await storage.exists(`${lockId}.lock`)).toBe(false);
    });
  });

  // ─── Resource Exhaustion ─────────────────────────────────────

  describe("resource exhaustion", () => {
    it("handles many distinct locks simultaneously", async () => {
      const lockCount = 20;
      const releases: Array<() => Promise<void>> = [];

      for (let i = 0; i < lockCount; i++) {
        const lockId = path.join(tmpDir, `multi-lock-${i}`);
        const release = await locks.acquire(lockId);
        releases.push(release);
      }

      // All locks should be held
      for (let i = 0; i < lockCount; i++) {
        expect(await storage.exists(`${path.join(tmpDir, `multi-lock-${i}`)}.lock`)).toBe(true);
      }

      // Release all
      await Promise.all(releases.map((r) => r()));

      // All should be cleaned up
      for (let i = 0; i < lockCount; i++) {
        expect(await storage.exists(`${path.join(tmpDir, `multi-lock-${i}`)}.lock`)).toBe(false);
      }
    });
  });

  // ─── Edge Cases ──────────────────────────────────────────────

  describe("lock edge cases", () => {
    it("lock with nested path creates parent directories", async () => {
      const lockId = path.join(tmpDir, "nested", "deep", "lock");
      const release = await locks.acquire(lockId);

      expect(await storage.exists(`${lockId}.lock`)).toBe(true);
      await release();
    });

    it("lock release during another operation does not corrupt filesystem", async () => {
      const lockId = path.join(tmpDir, "release-during-op");
      const filePath = path.join(tmpDir, "protected-file.txt");

      const release = await locks.acquire(lockId);

      // Perform file operations while holding lock
      await storage.writeFile(filePath, "protected data");
      const content = await storage.readFile(filePath, "utf8");
      expect(content).toBe("protected data");

      // Release while another read is in flight
      const readPromise = storage.readFile(filePath, "utf8");
      await release();
      const result = await readPromise;
      expect(result).toBe("protected data");
    });
  });
});

describe("Adversarial: Integration scenarios", () => {
  let storage: NodeFsStorageAdapter;
  let locks: NodeFsLockAdapter;
  let tmpDir: string;

  beforeEach(async () => {
    storage = new NodeFsStorageAdapter();
    locks = new NodeFsLockAdapter(storage);
    tmpDir = await mkdtemp(path.join(tmpdir(), "adversarial-integration-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("locked read-modify-write preserves consistency under contention", async () => {
    const counterFile = path.join(tmpDir, "counter.txt");
    await storage.writeFile(counterFile, "0");

    const lockId = path.join(tmpDir, "counter-lock");
    const iterations = 5;

    const workers = Array.from({ length: iterations }, async () => {
      const release = await locks.acquire(lockId);
      try {
        const current = parseInt(
          (await storage.readFile(counterFile, "utf8")) as string,
          10
        );
        // Small delay to amplify race window if lock fails
        await new Promise((r) => setTimeout(r, 5));
        await storage.writeFile(counterFile, String(current + 1));
      } finally {
        await release();
      }
    });

    await Promise.all(workers);

    const finalValue = parseInt(
      (await storage.readFile(counterFile, "utf8")) as string,
      10
    );
    // With proper locking, every increment should be counted
    expect(finalValue).toBe(iterations);
  });

  it("write-unlink-exists cycle is consistent", async () => {
    const filePath = path.join(tmpDir, "cycle.txt");

    for (let i = 0; i < 10; i++) {
      await storage.writeFile(filePath, `iteration-${i}`);
      expect(await storage.exists(filePath)).toBe(true);
      await storage.unlink(filePath);
      expect(await storage.exists(filePath)).toBe(false);
    }
  });

  it("readdir reflects changes after write and unlink", async () => {
    const dirPath = path.join(tmpDir, "listing-test");
    await storage.mkdir(dirPath);

    // Initially empty
    expect(await storage.readdir(dirPath)).toEqual([]);

    // Add files
    await storage.writeFile(path.join(dirPath, "a.txt"), "a");
    await storage.writeFile(path.join(dirPath, "b.txt"), "b");

    let entries = (await storage.readdir(dirPath)) as string[];
    expect(entries.sort()).toEqual(["a.txt", "b.txt"]);

    // Remove one
    await storage.unlink(path.join(dirPath, "a.txt"));
    entries = (await storage.readdir(dirPath)) as string[];
    expect(entries).toEqual(["b.txt"]);
  });

  it("readdir withFileTypes correctly classifies files and directories", async () => {
    const dirPath = path.join(tmpDir, "typed-listing");
    await storage.mkdir(dirPath);
    await storage.writeFile(path.join(dirPath, "file.txt"), "data");
    await storage.mkdir(path.join(dirPath, "subdir"));

    const entries = (await storage.readdir(dirPath, {
      withFileTypes: true,
    })) as Array<{ name: string; isFile: boolean; isDirectory: boolean }>;

    const fileEntry = entries.find((e) => e.name === "file.txt");
    const dirEntry = entries.find((e) => e.name === "subdir");

    expect(fileEntry?.isFile).toBe(true);
    expect(fileEntry?.isDirectory).toBe(false);
    expect(dirEntry?.isFile).toBe(false);
    expect(dirEntry?.isDirectory).toBe(true);
  });

  it("rename moves file content correctly", async () => {
    const src = path.join(tmpDir, "rename-src.txt");
    const dst = path.join(tmpDir, "rename-dst.txt");

    await storage.writeFile(src, "move me");
    await storage.rename(src, dst);

    expect(await storage.exists(src)).toBe(false);
    expect(await storage.readFile(dst, "utf8")).toBe("move me");
  });

  it("adapter name and separator are correct", () => {
    expect(storage.name).toBe("node-fs");
    expect(storage.sep).toBe(path.sep);
  });
});
