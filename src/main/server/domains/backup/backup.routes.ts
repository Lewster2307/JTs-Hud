import { Router, Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import AdmZip from 'adm-zip'
import { TeamService } from '../teams/team.service'
import { PlayerService } from '../players/player.service'
import { uploadsPath } from '../../utils/multer'

const router = Router()
const teamService = new TeamService()
const playerService = new PlayerService()

const uploadZip = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 150 * 1024 * 1024 } // 150MB limit
})

// GET /api/backup/export — Export all teams and players with images into a ZIP file
router.get('/export', async (_req: Request, res: Response) => {
  try {
    const teams = await teamService.getTeams()
    const players = await playerService.getPlayers()

    const teamMap = new Map(teams.map((t) => [t._id, t]))
    const zip = new AdmZip()

    // Exported teams list for data.json
    const exportedTeams = teams.map((team) => {
      let zipLogoPath: string | null = null
      if (team.logo) {
        const filename = path.basename(team.logo)
        const fullPath = path.join(uploadsPath, filename)
        if (fs.existsSync(fullPath)) {
          const ext = path.extname(filename) || '.png'
          const zipName = `team_${team._id}${ext}`
          zip.addLocalFile(fullPath, 'images/teams', zipName)
          zipLogoPath = `images/teams/${zipName}`
        }
      }
      return {
        id: team._id,
        name: team.name,
        shortName: team.shortName,
        country: team.country,
        logo: zipLogoPath,
        extra: team.extra || {}
      }
    })

    // Exported players list for data.json
    const exportedPlayers = players.map((player) => {
      let zipAvatarPath: string | null = null
      if (player.avatar) {
        const filename = path.basename(player.avatar)
        const fullPath = path.join(uploadsPath, filename)
        if (fs.existsSync(fullPath)) {
          const ext = path.extname(filename) || '.png'
          const safeIdentifier = (player.steamid || player._id).replace(/[^a-zA-Z0-9_-]/g, '_')
          const zipName = `player_${safeIdentifier}${ext}`
          zip.addLocalFile(fullPath, 'images/players', zipName)
          zipAvatarPath = `images/players/${zipName}`
        }
      }

      const teamObj = player.team ? teamMap.get(player.team) : null

      return {
        id: player._id,
        username: player.username,
        firstName: player.firstName,
        lastName: player.lastName,
        steamid: player.steamid,
        country: player.country,
        teamId: player.team || null,
        teamName: teamObj ? teamObj.name : null,
        isCoach: player.isCoach || false,
        avatar: zipAvatarPath,
        extra: player.extra || {}
      }
    })

    const dataJson = {
      version: 1,
      exportedAt: new Date().toISOString(),
      teams: exportedTeams,
      players: exportedPlayers
    }

    zip.addFile('data.json', Buffer.from(JSON.stringify(dataJson, null, 2), 'utf-8'))

    const zipBuffer = zip.toBuffer()
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="jts-hud-backup-${timestamp}.zip"`)
    res.setHeader('Content-Length', zipBuffer.length)
    res.send(zipBuffer)
  } catch (error: any) {
    console.error('Backup export failed:', error)
    res.status(500).json({ error: error.message || 'Export failed' })
  }
})

// POST /api/backup/inspect — Inspect a backup zip to detect potential duplicate teams and players
router.post('/inspect', uploadZip.single('file'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file || !req.file.buffer) {
      res.status(400).json({ error: 'No backup zip file provided' })
      return
    }

    const zip = new AdmZip(req.file.buffer)
    const dataEntry = zip.getEntry('data.json')
    if (!dataEntry) {
      res.status(400).json({ error: 'Invalid backup file: data.json not found in archive' })
      return
    }

    const rawJson = dataEntry.getData().toString('utf-8')
    const parsedData = JSON.parse(rawJson)

    const teamsList: any[] = Array.isArray(parsedData.teams) ? parsedData.teams : []
    const playersList: any[] = Array.isArray(parsedData.players) ? parsedData.players : []

    const existingTeams = await teamService.getTeams()
    const existingPlayers = await playerService.getPlayers()

    const existingTeamNames = new Set(existingTeams.map((t) => (t.name || '').trim().toLowerCase()))
    const existingPlayerUsernames = new Set(
      existingPlayers.map((p) => (p.username || '').trim().toLowerCase())
    )

    const duplicateTeams: string[] = []
    const seenImportTeams = new Set<string>()
    for (const t of teamsList) {
      const name = String(t.name || '').trim()
      const key = name.toLowerCase()
      if (!key) continue
      if (existingTeamNames.has(key) && !seenImportTeams.has(key)) {
        duplicateTeams.push(name)
      }
      seenImportTeams.add(key)
    }

    const duplicatePlayers: string[] = []
    const seenImportPlayers = new Set<string>()
    for (const p of playersList) {
      const uname = String(p.username || '').trim()
      const key = uname.toLowerCase()
      if (!key) continue
      if (existingPlayerUsernames.has(key) && !seenImportPlayers.has(key)) {
        duplicatePlayers.push(uname)
      }
      seenImportPlayers.add(key)
    }

    res.json({
      valid: true,
      totalTeams: teamsList.length,
      totalPlayers: playersList.length,
      conflicts: {
        teams: duplicateTeams,
        players: duplicatePlayers
      }
    })
  } catch (error: any) {
    console.error('Backup inspection failed:', error)
    res.status(500).json({ error: error.message || 'Inspection failed' })
  }
})

// POST /api/backup/import — Import teams and players from an uploaded ZIP file
router.post('/import', uploadZip.single('file'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file || !req.file.buffer) {
      res.status(400).json({ error: 'No backup zip file provided' })
      return
    }

    const teamConflictStrategy = (req.body.teamConflictStrategy || 'overwrite') as 'overwrite' | 'skip'
    const playerConflictStrategy = (req.body.playerConflictStrategy || 'overwrite') as 'overwrite' | 'skip'

    const zip = new AdmZip(req.file.buffer)
    const dataEntry = zip.getEntry('data.json')
    if (!dataEntry) {
      res.status(400).json({ error: 'Invalid backup file: data.json not found in archive' })
      return
    }

    const rawJson = dataEntry.getData().toString('utf-8')
    const parsedData = JSON.parse(rawJson)

    const teamsList: any[] = Array.isArray(parsedData.teams) ? parsedData.teams : []
    const playersList: any[] = Array.isArray(parsedData.players) ? parsedData.players : []

    const existingTeams = await teamService.getTeams()
    const existingPlayers = await playerService.getPlayers()

    const teamIdMap = new Map<string, string>()
    const teamNameMap = new Map<string, string>()
    const playerNameMap = new Map<string, string>()

    for (const t of existingTeams) {
      if (t.name) teamNameMap.set(t.name.trim().toLowerCase(), t._id)
    }

    for (const p of existingPlayers) {
      if (p.username) playerNameMap.set(p.username.trim().toLowerCase(), p._id)
    }

    // Ensure uploads directory exists
    if (!fs.existsSync(uploadsPath)) {
      fs.mkdirSync(uploadsPath, { recursive: true })
    }

    let createdTeamsCount = 0
    let updatedTeamsCount = 0
    let skippedTeamsCount = 0

    let createdPlayersCount = 0
    let updatedPlayersCount = 0
    let skippedPlayersCount = 0

    // 1. Process teams — unique by team name
    for (const teamItem of teamsList) {
      const teamNameKey = String(teamItem.name || '').trim().toLowerCase()
      if (!teamNameKey) continue

      let logoUrl: string | null = null
      if (teamItem.logo) {
        const logoEntry = zip.getEntry(teamItem.logo)
        if (logoEntry) {
          const ext = path.extname(logoEntry.entryName) || '.png'
          const uniqueFilename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`
          const destPath = path.join(uploadsPath, uniqueFilename)
          fs.writeFileSync(destPath, logoEntry.getData())
          logoUrl = `/api/uploads/${uniqueFilename}`
        }
      }

      const existingId = teamNameMap.get(teamNameKey)

      if (existingId) {
        teamIdMap.set(teamItem.id, existingId)
        if (teamConflictStrategy === 'skip') {
          skippedTeamsCount++
          continue
        }

        // Overwrite existing team
        const existing = existingTeams.find((t) => t._id === existingId)
        await teamService.updateTeam(existingId, {
          shortName: teamItem.shortName || (existing ? existing.shortName : ''),
          country: teamItem.country || (existing ? existing.country : ''),
          ...(logoUrl ? { logo: logoUrl } : {}),
          extra: teamItem.extra || (existing ? existing.extra : {})
        })
        updatedTeamsCount++
      } else {
        const created = await teamService.createTeam({
          name: teamItem.name,
          shortName: teamItem.shortName || '',
          country: teamItem.country || '',
          logo: logoUrl || '',
          extra: teamItem.extra || {}
        })
        teamIdMap.set(teamItem.id, created._id)
        teamNameMap.set(teamNameKey, created._id)
        createdTeamsCount++
      }
    }

    // 2. Process players — unique by username
    for (const playerItem of playersList) {
      const playerUsernameKey = String(playerItem.username || '').trim().toLowerCase()
      if (!playerUsernameKey) continue

      let avatarUrl: string | null = null
      if (playerItem.avatar) {
        const avatarEntry = zip.getEntry(playerItem.avatar)
        if (avatarEntry) {
          const ext = path.extname(avatarEntry.entryName) || '.png'
          const uniqueFilename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`
          const destPath = path.join(uploadsPath, uniqueFilename)
          fs.writeFileSync(destPath, avatarEntry.getData())
          avatarUrl = `/api/uploads/${uniqueFilename}`
        }
      }

      // Resolve team link: try mapped teamId first, then try finding by teamName
      let resolvedTeamId: string | null = null
      if (playerItem.teamId && teamIdMap.has(playerItem.teamId)) {
        resolvedTeamId = teamIdMap.get(playerItem.teamId) || null
      } else if (playerItem.teamName) {
        const tKey = String(playerItem.teamName).trim().toLowerCase()
        resolvedTeamId = teamNameMap.get(tKey) || null
      }

      const existingPlayerId = playerNameMap.get(playerUsernameKey)

      if (existingPlayerId) {
        if (playerConflictStrategy === 'skip') {
          skippedPlayersCount++
          continue
        }

        // Overwrite existing player
        const existingPlayer = existingPlayers.find((p) => p._id === existingPlayerId)
        await playerService.updatePlayer(existingPlayerId, {
          username: playerItem.username,
          firstName:
            playerItem.firstName !== undefined
              ? playerItem.firstName
              : existingPlayer
                ? existingPlayer.firstName
                : '',
          lastName:
            playerItem.lastName !== undefined
              ? playerItem.lastName
              : existingPlayer
                ? existingPlayer.lastName
                : '',
          country:
            playerItem.country !== undefined
              ? playerItem.country
              : existingPlayer
                ? existingPlayer.country
                : '',
          steamid:
            playerItem.steamid !== undefined
              ? playerItem.steamid
              : existingPlayer
                ? existingPlayer.steamid
                : '',
          team: resolvedTeamId !== null ? resolvedTeamId : existingPlayer ? existingPlayer.team : '',
          isCoach:
            playerItem.isCoach !== undefined
              ? playerItem.isCoach
              : existingPlayer
                ? existingPlayer.isCoach
                : false,
          ...(avatarUrl ? { avatar: avatarUrl } : {}),
          extra: playerItem.extra || (existingPlayer ? existingPlayer.extra : {})
        })
        updatedPlayersCount++
      } else {
        const createdPlayer = await playerService.createPlayer({
          username: playerItem.username || '',
          firstName: playerItem.firstName || '',
          lastName: playerItem.lastName || '',
          steamid: playerItem.steamid || '',
          country: playerItem.country || '',
          team: resolvedTeamId || '',
          isCoach: Boolean(playerItem.isCoach),
          avatar: avatarUrl || '',
          extra: playerItem.extra || {}
        })
        playerNameMap.set(playerUsernameKey, createdPlayer._id)
        createdPlayersCount++
      }
    }

    res.json({
      success: true,
      teams: {
        total: teamsList.length,
        created: createdTeamsCount,
        updated: updatedTeamsCount,
        skipped: skippedTeamsCount
      },
      players: {
        total: playersList.length,
        created: createdPlayersCount,
        updated: updatedPlayersCount,
        skipped: skippedPlayersCount
      }
    })
  } catch (error: any) {
    console.error('Backup import failed:', error)
    res.status(500).json({ error: error.message || 'Import failed' })
  }
})

export default router
