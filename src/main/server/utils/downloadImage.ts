import path from 'path'
import fs from 'fs'
import { BrowserWindow } from 'electron'
import { uploadsPath } from './multer'

function detectExtensionFromBuffer(buffer: Buffer, fallbackExt = '.png'): string {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return '.png'
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return '.jpg'
  }
  if (
    buffer.length >= 6 &&
    (buffer.toString('ascii', 0, 6) === 'GIF87a' || buffer.toString('ascii', 0, 6) === 'GIF89a')
  ) {
    return '.gif'
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return '.webp'
  }
  if (buffer.toString('utf8', 0, 100).includes('<svg')) {
    return '.svg'
  }
  return fallbackExt
}

async function downloadImageViaBrowserWindow(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let win: BrowserWindow | null = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: {
        offscreen: true,
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    let isDone = false
    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId)
      if (win && !win.isDestroyed()) {
        try {
          win.destroy()
        } catch {
          /* ignore */
        }
      }
      win = null
    }

    const timeoutId = setTimeout(() => {
      if (isDone) return
      isDone = true
      cleanup()
      reject(new Error('Image download timed out (Cloudflare challenge or connection timeout)'))
    }, 20000)

    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      if (isDone) return
      isDone = true
      cleanup()
      reject(new Error(`Failed to load image in browser: ${errorDescription} (${errorCode})`))
    })

    win.webContents.on('did-finish-load', async () => {
      if (isDone) return
      try {
        // First try exact same-origin fetch of original bytes
        const result = await win!.webContents.executeJavaScript(`
          (async () => {
            try {
              const res = await fetch(window.location.href);
              if (res.ok) {
                const buf = await res.arrayBuffer();
                const bytes = new Uint8Array(buf);
                let binary = '';
                for (let i = 0; i < bytes.byteLength; i++) {
                  binary += String.fromCharCode(bytes[i]);
                }
                return { type: 'binary', data: btoa(binary) };
              }
            } catch (e) {
              /* fallback below */
            }

            return new Promise((resolve, reject) => {
              const img = document.querySelector('img');
              if (!img) return reject(new Error('No image found in page'));
              const extract = () => {
                try {
                  const canvas = document.createElement('canvas');
                  canvas.width = img.naturalWidth || img.width;
                  canvas.height = img.naturalHeight || img.height;
                  const ctx = canvas.getContext('2d');
                  ctx.drawImage(img, 0, 0);
                  resolve({ type: 'dataUrl', data: canvas.toDataURL('image/png') });
                } catch (err) {
                  reject(err);
                }
              };
              if (img.complete && img.naturalWidth > 0) {
                extract();
              } else {
                img.onload = extract;
                img.onerror = () => reject(new Error('Image failed to render'));
              }
            });
          })()
        `)

        if (!result || !result.data) {
          throw new Error('Could not extract image from page')
        }

        let buffer: Buffer
        if (result.type === 'dataUrl') {
          const raw = result.data.replace(/^data:image\/\w+;base64,/, '')
          buffer = Buffer.from(raw, 'base64')
        } else {
          buffer = Buffer.from(result.data, 'base64')
        }

        isDone = true
        cleanup()
        resolve(buffer)
      } catch (err: any) {
        if (!isDone) {
          isDone = true
          cleanup()
          reject(new Error(`Failed to extract image: ${err.message}`))
        }
      }
    })

    win.loadURL(url)
  })
}

export async function downloadImageFromUrl(imageUrl: string): Promise<string> {
  const trimmed = imageUrl.trim()
  const parsed = new URL(trimmed)

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Invalid URL protocol. Only HTTP and HTTPS are supported.')
  }

  const urlExt = path.extname(parsed.pathname).toLowerCase()
  const isImageExt = ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif', '.avif'].includes(urlExt)
  const initialExt = isImageExt ? urlExt : '.png'

  let buffer: Buffer | null = null
  let detectedExt = initialExt

  // 1. First, attempt fast direct fetch with browser headers
  try {
    const response = await fetch(trimmed, {
      signal: AbortSignal.timeout(10000),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        Referer: parsed.origin
      }
    })

    if (response.ok) {
      const contentType = (response.headers.get('content-type') || '').toLowerCase()
      if (contentType.includes('png')) detectedExt = '.png'
      else if (contentType.includes('jpeg') || contentType.includes('jpg')) detectedExt = '.jpg'
      else if (contentType.includes('webp')) detectedExt = '.webp'
      else if (contentType.includes('svg')) detectedExt = '.svg'
      else if (contentType.includes('gif')) detectedExt = '.gif'
      else if (contentType.includes('avif')) detectedExt = '.avif'
      else if (isImageExt) detectedExt = urlExt

      const arrayBuffer = await response.arrayBuffer()
      buffer = Buffer.from(arrayBuffer)
    }
  } catch {
    /* Fallback to offscreen browser window */
  }

  // 2. If direct fetch was blocked (e.g. Cloudflare 403 on HLTV) or failed, use offscreen BrowserWindow
  if (!buffer || buffer.length === 0) {
    buffer = await downloadImageViaBrowserWindow(trimmed)
    detectedExt = detectExtensionFromBuffer(buffer, initialExt)
  }

  if (!buffer || buffer.length === 0) {
    throw new Error('Downloaded image file is empty.')
  }

  if (buffer.length > 50 * 1024 * 1024) {
    throw new Error('Image exceeds 50MB size limit.')
  }

  if (!fs.existsSync(uploadsPath)) {
    fs.mkdirSync(uploadsPath, { recursive: true })
  }

  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${detectedExt}`
  const filePath = path.join(uploadsPath, filename)
  fs.writeFileSync(filePath, buffer)

  return `/api/uploads/${filename}`
}
