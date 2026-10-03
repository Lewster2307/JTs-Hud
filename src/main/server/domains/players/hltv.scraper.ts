// src/main/server/domains/players/hltv.scraper.ts
import { BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import { downloadImageFromUrl } from '../../utils/downloadImage'
import { resolveCountryCode } from '../../utils/countries'

export interface HltvScrapedPlayer {
  username: string
  firstName: string
  lastName: string
  country: string
  countryName: string
  team: string
  avatar: string
  avatarUrl: string
}

export interface RawScrapedPlayerData {
  username: string
  firstName: string
  lastName: string
  countryTitle: string
  countrySrc: string
  team: string
  avatarUrl: string
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function parsePlayerHtml(html: string): RawScrapedPlayerData | null {
  if (
    !html ||
    html.includes('challenge-platform') ||
    html.includes('Just a moment') ||
    html.includes('cf_chl_') ||
    !html.includes('playerNickname')
  ) {
    return null
  }

  const unameMatch = html.match(/<h1[^>]*class="[^"]*playerNickname[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)
  const realNameMatch = html.match(/<div[^>]*class="[^"]*playerRealname[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
  const flagMatch = html.match(/<div[^>]*class="[^"]*player-summary-stat-box-left-flag[^"]*"[\s\S]*?<img[^>]*>/i)
  const flagImg = flagMatch ? flagMatch[0] : ''
  const countryTitle = (flagImg.match(/title="([^"]+)"/i) || [])[1] || ''
  const countryAlt = (flagImg.match(/alt="([^"]+)"/i) || [])[1] || ''
  const countrySrc = (flagImg.match(/src="([^"]+)"/i) || [])[1] || ''

  // Team extraction
  let team = ''
  const teamLinkMatch =
    html.match(/<a[^>]*href="\/team\/[^"]*"[^>]*>([\s\S]*?)<\/a>/i) ||
    html.match(/<div[^>]*class="[^"]*playerTeam[^"]*"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)

  if (teamLinkMatch && teamLinkMatch[1]) {
    team = decodeHtml(teamLinkMatch[1].replace(/<[^>]+>/g, '').trim())
  }
  if (!team) {
    const rowMatch = html.match(/<span[^>]*>\s*Team\s*<\/span>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)
    if (rowMatch && rowMatch[1]) {
      team = decodeHtml(rowMatch[1].replace(/<[^>]+>/g, '').trim())
    }
  }

  // Extract transparent avatar image from bodyshot wrapper
  const wrapperMatch = html.match(
    /<div[^>]*class="[^"]*player-summary-stat-box-left-bodyshot-wrapper[^"]*"[\s\S]*?(<img[^>]+>)[\s\S]*?<\/div>/i
  )
  const imgTag = wrapperMatch
    ? wrapperMatch[1]
    : (html.match(/<img[^>]+class="[^"]*bodyshot[^"]*"[^>]*>/i) ||
       html.match(/<img[^>]+bodyshot[^>]*>/i) ||
       [])[0]

  let avatarUrl = ''
  if (imgTag) {
    const srcMatch = imgTag.match(/\ssrc="([^"]+)"/i)
    if (srcMatch && srcMatch[1]) {
      avatarUrl = decodeHtml(srcMatch[1].trim())
    }
  }

  const rawUsername = unameMatch ? decodeHtml(unameMatch[1].trim()) : ''
  if (!rawUsername || rawUsername.toLowerCase().includes('hltv.org')) {
    return null
  }

  const fullName = realNameMatch ? decodeHtml(realNameMatch[1].trim()) : ''
  const words = fullName ? fullName.split(/\s+/).filter(Boolean) : []
  const firstName = words[0] || ''
  const lastName = words.slice(1).join(' ') || ''

  return {
    username: rawUsername,
    firstName,
    lastName,
    countryTitle: decodeHtml(countryTitle || countryAlt),
    countrySrc,
    team,
    avatarUrl
  }
}

async function fetchViaCurl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'curl.exe',
      [
        '-s',
        '-L',
        '--max-time',
        '10',
        '-A',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        '-H',
        'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        '-H',
        'Accept-Language: en-US,en;q=0.9',
        url
      ],
      { maxBuffer: 15 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return reject(error)
        resolve(stdout)
      }
    )
  })
}

async function fetchViaBrowserWindow(url: string): Promise<RawScrapedPlayerData> {
  return new Promise((resolve, reject) => {
    let win: BrowserWindow | null = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        offscreen: false,
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false
      }
    })

    let isDone = false
    let pollInterval: NodeJS.Timeout | null = null
    let elapsedMs = 0

    const cleanup = () => {
      if (pollInterval) {
        clearInterval(pollInterval)
        pollInterval = null
      }
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
      reject(new Error('HLTV request timed out. Please check the URL and try again.'))
    }, 30000)

    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (isDone || !isMainFrame || errorCode === -3) return
      isDone = true
      cleanup()
      reject(new Error(`Failed to load HLTV player page: ${errorDescription} (${errorCode})`))
    })

    const checkPage = async () => {
      if (isDone || !win || win.isDestroyed()) return
      elapsedMs += 1000

      if (elapsedMs >= 4000 && win && !win.isVisible()) {
        try {
          win.show()
          win.focus()
        } catch {
          /* ignore */
        }
      }

      try {
        const title = (win.webContents.getTitle() || '').toLowerCase()
        if (
          title.includes('just a moment') ||
          title.includes('attention required') ||
          title.includes('cloudflare') ||
          title.includes('challenge') ||
          title === 'www.hltv.org'
        ) {
          return // Still on Cloudflare challenge screen
        }

        const extracted = await win.webContents.executeJavaScript(`
          (() => {
            function getByXPath(xpath) {
              try {
                const res = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                return res.singleNodeValue;
              } catch (e) {
                return null;
              }
            }

            // 1. Username: /html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[1]/div[3]/div[1]/div[1]/h1
            const usernameEl =
              getByXPath('/html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[1]/div[3]/div[1]/div[1]/h1') ||
              document.querySelector('h1.playerNickname') ||
              document.querySelector('.playerNickname');

            if (!usernameEl) return null;

            const username = (usernameEl.textContent || '').trim();
            const lowerUser = username.toLowerCase();
            if (
              !username ||
              lowerUser.includes('hltv.org') ||
              lowerUser.includes('cloudflare') ||
              lowerUser.includes('just a moment') ||
              lowerUser.includes('attention required') ||
              lowerUser.includes('turnstile')
            ) {
              return null;
            }

            // 2. Real name: /html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[1]/div[3]/div[1]/div[1]/div
            const nameEl =
              getByXPath('/html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[1]/div[3]/div[1]/div[1]/div') ||
              document.querySelector('.playerRealname') ||
              document.querySelector('.player-realname');

            const fullName = nameEl ? (nameEl.textContent || '').trim() : '';
            const words = fullName ? fullName.split(/\\s+/).filter(Boolean) : [];
            const firstName = words[0] || '';
            const lastName = words.slice(1).join(' ') || '';

            // 3. Country: /html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[1]/div[2]/div[1]/div/img
            const countryEl =
              getByXPath('/html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[1]/div[2]/div[1]/div/img') ||
              document.querySelector('.player-summary-stat-box-left-flag img') ||
              document.querySelector('.player-summary-stat-box-left-flag') ||
              document.querySelector('img.flag');

            const countryTitle = countryEl
              ? (countryEl.getAttribute('title') || countryEl.getAttribute('alt') || '')
              : '';
            const countrySrc = countryEl
              ? (countryEl.getAttribute('src') || countryEl.src || '')
              : '';

            // 4. Team: /html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[1]/div[3]/div[2]/div[2]/span[2]/span/a
            const teamEl =
              getByXPath('/html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[1]/div[3]/div[2]/div[2]/span[2]/span/a') ||
              getByXPath('/html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[1]/div[3]/div[2]/div[2]//a') ||
              document.querySelector('.playerTeam a') ||
              document.querySelector('.player-team a');

            let team = '';
            if (teamEl) {
              team = (teamEl.textContent || '').trim();
            }
            if (!team) {
              const allSpans = Array.from(document.querySelectorAll('span, div'));
              const teamLabel = allSpans.find(
                s => s.children.length === 0 && s.textContent.trim().toLowerCase() === 'team'
              );
              if (teamLabel && teamLabel.parentElement) {
                const link = teamLabel.parentElement.querySelector('a[href*="/team/"]');
                if (link) {
                  team = (link.textContent || '').trim();
                }
              }
            }
            if (!team) {
              const generalLink = document.querySelector('a[href*="/team/"]');
              if (generalLink) {
                team = (generalLink.textContent || '').trim();
              }
            }
            if (team === '-' || team.toLowerCase() === 'n/a' || team.toLowerCase() === 'no team') {
              team = '';
            }

            // 5. Avatar: /html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[1]/div[2]/div[2]/img
            const avatarEl =
              getByXPath('/html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[1]/div[2]/div[2]/img') ||
              document.querySelector('.player-summary-stat-box-left-bodyshot-wrapper img') ||
              document.querySelector('img.bodyshot') ||
              document.querySelector('.bodyshot');

            let avatarUrl = '';
            if (avatarEl) {
              avatarUrl = avatarEl.getAttribute('src') || avatarEl.src || '';
            }

            return {
              username,
              firstName,
              lastName,
              countryTitle,
              countrySrc,
              team,
              avatarUrl
            };
          })()
        `)

        if (extracted && extracted.username) {
          isDone = true
          cleanup()
          resolve(extracted)
        }
      } catch {
        /* continue polling */
      }
    }

    win.webContents.on('did-finish-load', () => {
      checkPage()
    })

    pollInterval = setInterval(checkPage, 1000)

    win.loadURL(url).catch((err) => {
      if (isDone) return
      isDone = true
      cleanup()
      reject(new Error(`Could not connect to HLTV: ${err.message}`))
    })
  })
}

export async function scrapeHltvPlayer(rawUrl: string): Promise<HltvScrapedPlayer> {
  let targetUrl = rawUrl.trim()
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = 'https://' + targetUrl
  }

  let parsed: URL
  try {
    parsed = new URL(targetUrl)
  } catch {
    throw new Error('Please enter a valid URL')
  }

  if (!parsed.hostname.includes('hltv.org') || !parsed.pathname.includes('/player/')) {
    throw new Error('Please enter a valid HLTV player profile URL (e.g. https://www.hltv.org/player/11816/ropz)')
  }

  let extractedData: RawScrapedPlayerData | null = null

  // 1. Try fast curl fetch
  try {
    const html = await fetchViaCurl(targetUrl)
    const parsed = parsePlayerHtml(html)
    if (parsed && parsed.username) {
      extractedData = parsed
    }
  } catch (err) {
    console.warn('[HLTV Scraper] Direct curl fetch failed, falling back to BrowserWindow:', err)
  }

  // 2. Fallback to BrowserWindow
  if (!extractedData || !extractedData.username) {
    try {
      extractedData = await fetchViaBrowserWindow(targetUrl)
    } catch (err: any) {
      throw new Error(`Failed to fetch HLTV player profile: ${err.message}`)
    }
  }

  if (!extractedData || !extractedData.username) {
    throw new Error('Could not extract player information from the provided HLTV URL. Please verify the profile link.')
  }

  const countryCode = resolveCountryCode(extractedData.countryTitle, extractedData.countrySrc)

  let fullAvatarUrl = extractedData.avatarUrl
  if (fullAvatarUrl) {
    if (fullAvatarUrl.startsWith('//')) {
      fullAvatarUrl = 'https:' + fullAvatarUrl
    } else if (fullAvatarUrl.startsWith('/')) {
      fullAvatarUrl = 'https://www.hltv.org' + fullAvatarUrl
    }

    try {
      const u = new URL(fullAvatarUrl)
      if (u.searchParams.has('bg')) {
        u.searchParams.delete('bg')
      }
      fullAvatarUrl = u.toString()
    } catch {
      fullAvatarUrl = fullAvatarUrl.replace(/([?&])bg=[^&]+(&|$)/, (_, p1, p2) => (p2 === '&' ? p1 : ''))
    }
  }

  let localAvatarPath = ''
  if (fullAvatarUrl) {
    try {
      localAvatarPath = await downloadImageFromUrl(fullAvatarUrl)
    } catch (err: any) {
      console.warn('[HLTV Scraper] Failed to download avatar locally, using remote URL:', err.message)
      localAvatarPath = fullAvatarUrl
    }
  }

  return {
    username: extractedData.username,
    firstName: extractedData.firstName,
    lastName: extractedData.lastName,
    country: countryCode,
    countryName: extractedData.countryTitle,
    team: extractedData.team,
    avatar: localAvatarPath,
    avatarUrl: fullAvatarUrl
  }
}
