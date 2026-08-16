//! 磁盘溢出段（§8.3/§8.5）：append 日志（`u32 BE 长度 + BufferedFrame JSON`），
//! 0600。
//!
//! 写句柄与读句柄独立（读前 flush 保证同进程可见，P1-7：不做每帧 flush）；
//! 「从段首丢弃」= 推进跳过游标（append-only，不重写文件）。

use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use peri_studio_proto::instance::BufferedFrame;

/// 读侧长度前缀上限防御（问题 16）：写侧受 `u32::try_from` 与调用方单帧上限
/// 约束，读侧若不校验，损坏文件可触发 4GB 分配。上限 = 单帧上限（1MB）+ 4B
/// 前缀；但本模块不依赖调用方配置，取宽松上限（64MB）兜底——合法帧必然
/// 远小于此，超限即判定文件损坏。
const MAX_RECORD_BYTES: usize = 64 * 1024 * 1024;

pub struct DiskSegment {
    pub(crate) path: PathBuf,
    writer: BufWriter<File>,
    reader: Option<BufReader<File>>,
    /// 文件内全部记录数（含已跳过）。
    records: u64,
    /// 已从段首跳过的记录数（丢弃/commit 消费）。
    skip_records: u64,
    /// 已跳过字节数（读游标偏移）。
    skip_bytes: usize,
    /// writer 缓冲是否有未刷到内核的数据（读路径需先 flush 一次）。
    dirty: bool,
}

impl DiskSegment {
    pub fn open(dir: &Path, chat_id: &str) -> std::io::Result<Self> {
        fs::create_dir_all(dir)?;
        let path = dir.join(format!("{chat_id}.buf"));
        let f = OpenOptions::new().create(true).append(true).open(&path)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = f.set_permissions(fs::Permissions::from_mode(0o600));
        }
        Ok(DiskSegment {
            path,
            writer: BufWriter::new(f),
            reader: None,
            records: 0,
            skip_records: 0,
            skip_bytes: 0,
            dirty: false,
        })
    }

    /// 追加一条记录（P1-7：不每帧 flush——数据停留在 BufWriter 缓冲，读可见性
    /// 由 [`Self::flush_writer`] 在读路径一次性保证；「崩溃即弃」语义（§3.3）
    /// 本就不需要落盘，省去每帧 5-50µs 的同步 flush）。
    pub fn append(&mut self, bytes: &[u8]) -> std::io::Result<()> {
        let len = u32::try_from(bytes.len())
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "frame too long (>4GB)"))?;
        self.writer.write_all(&len.to_be_bytes())?;
        self.writer.write_all(bytes)?;
        self.dirty = true;
        self.records += 1;
        Ok(())
    }

    /// 把 writer 缓冲刷到内核 page cache（独立读句柄可见性前置，P1-7）。
    /// 仅在存在未刷数据时执行一次；无脏数据时零开销。
    fn flush_writer(&mut self) -> std::io::Result<()> {
        if self.dirty {
            self.writer.flush()?;
            self.dirty = false;
        }
        Ok(())
    }

    /// 确保读句柄打开并定位到跳过游标（读前先 flush 一次，保证 writer 缓冲
    /// 对独立 reader 可见）。
    fn ensure_reader(&mut self) -> std::io::Result<&mut BufReader<File>> {
        self.flush_writer()?;
        if self.reader.is_none() {
            let f = File::open(&self.path)?;
            let r = BufReader::new(f);
            self.reader = Some(r);
        }
        let r = self.reader.as_mut().expect("reader already initialized");
        r.seek(SeekFrom::Start(self.skip_bytes as u64))?;
        Ok(r)
    }

    /// 读取段首一条记录（不消费；无记录 → None）。`out_len` 记录字节数。
    ///
    /// 长度防御（问题 16）：`u32` 长度前缀先校验上限（[`MAX_RECORD_BYTES`]），
    /// 损坏文件无法触发超大分配。
    pub fn peek_one(&mut self, out_len: &mut usize) -> std::io::Result<Option<BufferedFrame>> {
        if self.skip_records >= self.records {
            return Ok(None);
        }
        let r = self.ensure_reader()?;
        let mut len_buf = [0u8; 4];
        r.read_exact(&mut len_buf)?;
        let len = u32::from_be_bytes(len_buf) as usize;
        if len > MAX_RECORD_BYTES {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("corrupt buffer file: record length {len} exceeds {MAX_RECORD_BYTES}"),
            ));
        }
        let mut body = vec![0u8; len];
        r.read_exact(&mut body)?;
        let bf: BufferedFrame = serde_json::from_slice(&body).map_err(|e| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("corrupt buffer file: {e}"),
            )
        })?;
        *out_len = 4 + len;
        Ok(Some(bf))
    }

    /// 从段首消费（跳过）一条记录：返回 (帧, **body 字节数**（不含 4B 长度
    /// 前缀——与 push 侧的 `size` 口径一致，供预算计数；文件游标推进用完整
    /// 长度，见 `skip_bytes`））。
    pub fn consume_one(&mut self) -> std::io::Result<Option<(BufferedFrame, usize)>> {
        let mut len = 0;
        match self.peek_one(&mut len)? {
            Some(bf) => {
                self.skip_records += 1;
                self.skip_bytes += len;
                Ok(Some((bf, len.saturating_sub(4))))
            }
            None => Ok(None),
        }
    }
}
