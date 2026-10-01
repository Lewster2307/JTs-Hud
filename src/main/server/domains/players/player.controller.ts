import { Request, Response } from 'express'
import { PlayerService } from './player.service'
import { deleteUploadedFile } from '../../utils/multer'
import { downloadImageFromUrl } from '../../utils/downloadImage'
import { syncCoaches } from '../../integrations/gsi'

const playerService = new PlayerService()

export const getPlayers = async (req: Request, res: Response) => {
  try {
    const steamids = req.query.steamids as string | undefined
    const players = await playerService.getPlayers(steamids)
    res.json(players)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
}

export const getPlayerAvatar = async (req: Request, res: Response) => {
  try {
    const avatarData = await playerService.getPlayerAvatar(req.params.steamid as string)
    res.json(avatarData)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
}

export const getPlayerById = async (req: Request, res: Response) => {
  try {
    const player = await playerService.getPlayerById(req.params.id as string)
    if (!player) return res.status(404).json({ error: 'Player not found' })
    res.json(player)
    return
  } catch (error: any) {
    res.status(500).json({ error: error.message })
    return
  }
}

export const createPlayer = async (req: Request, res: Response) => {
  try {
    const playerData = req.body
    if (!playerData.username || typeof playerData.username !== 'string' || !playerData.username.trim()) {
      res.status(400).json({ error: 'Username is required' })
      return
    }
    playerData.username = playerData.username.trim()
    if (playerData.steamid && typeof playerData.steamid === 'string') {
      playerData.steamid = playerData.steamid.trim().replace(/\s+/g, '')
    }

    if (req.file) {
      playerData.avatar = `/api/uploads/${req.file.filename}`
    } else if (playerData.avatar && (playerData.avatar.startsWith('http://') || playerData.avatar.startsWith('https://'))) {
      playerData.avatar = await downloadImageFromUrl(playerData.avatar)
    }
    // FormData sends booleans as strings
    playerData.isCoach = playerData.isCoach === 'true' || playerData.isCoach === true
    const player = await playerService.createPlayer(playerData)
    syncCoaches()
    res.status(201).json(player)
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
}

export const updatePlayer = async (req: Request, res: Response) => {
  try {
    const playerData = req.body
    if (playerData.username !== undefined && (!playerData.username || typeof playerData.username !== 'string' || !playerData.username.trim())) {
      res.status(400).json({ error: 'Username cannot be empty' })
      return
    }
    if (playerData.username && typeof playerData.username === 'string') {
      playerData.username = playerData.username.trim()
    }
    if (playerData.steamid && typeof playerData.steamid === 'string') {
      playerData.steamid = playerData.steamid.trim().replace(/\s+/g, '')
    }

    const existing = await playerService.getPlayerById(req.params.id as string)

    if (req.file) {
      if (existing?.avatar) deleteUploadedFile(existing.avatar)
      playerData.avatar = `/api/uploads/${req.file.filename}`
    } else if (playerData.avatar && (playerData.avatar.startsWith('http://') || playerData.avatar.startsWith('https://'))) {
      if (existing?.avatar) deleteUploadedFile(existing.avatar)
      playerData.avatar = await downloadImageFromUrl(playerData.avatar)
    } else if (playerData.avatar === '' || playerData.avatar === null) {
      if (existing?.avatar) deleteUploadedFile(existing.avatar)
      playerData.avatar = ''
    } else if (playerData.avatar && existing?.avatar && playerData.avatar !== existing.avatar) {
      deleteUploadedFile(existing.avatar)
    }
    // FormData sends booleans as strings
    playerData.isCoach = playerData.isCoach === 'true' || playerData.isCoach === true
    const player = await playerService.updatePlayer(req.params.id as string, playerData)
    if (!player) return res.status(404).json({ error: 'Player not found' })
    syncCoaches()
    res.json(player)
    return
  } catch (error: any) {
    res.status(400).json({ error: error.message })
    return
  }
}

export const deletePlayer = async (req: Request, res: Response) => {
  try {
    const player = await playerService.getPlayerById(req.params.id as string)
    if (player?.avatar) deleteUploadedFile(player.avatar)
    await playerService.deletePlayer(req.params.id as string)
    syncCoaches()
    res.status(204).send()
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
}
