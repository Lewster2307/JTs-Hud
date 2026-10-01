import path from 'path'
import { Request, Response } from 'express'
import { TeamService } from './team.service'
import { uploadsPath, deleteUploadedFile } from '../../utils/multer'
import { downloadImageFromUrl } from '../../utils/downloadImage'
import { PlayerRepository } from '../players/player.repository'

const teamService = new TeamService()
const playerRepo = new PlayerRepository()

export const getTeamLogo = async (req: Request, res: Response) => {
  try {
    const filename = await teamService.getTeamLogoPath(req.params.id as string)
    if (!filename) return res.status(404).json({ error: 'Logo not found' })
    res.sendFile(path.join(uploadsPath, filename))
    return
  } catch (error: any) {
    res.status(500).json({ error: error.message })
    return
  }
}

export const getTeams = async (_req: Request, res: Response) => {
  try {
    const teams = await teamService.getTeams()
    res.json(teams)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
}

export const getTeamById = async (req: Request, res: Response) => {
  try {
    const team = await teamService.getTeamById(req.params.id as string)
    if (!team) return res.status(404).json({ error: 'Team not found' })
    res.json(team)
    return
  } catch (error: any) {
    res.status(500).json({ error: error.message })
    return
  }
}

export const createTeam = async (req: Request, res: Response) => {
  try {
    const teamData = req.body
    if (!teamData.name || typeof teamData.name !== 'string' || !teamData.name.trim()) {
      res.status(400).json({ error: 'Team name is required' })
      return
    }
    teamData.name = teamData.name.trim()
    if (teamData.shortName && typeof teamData.shortName === 'string') {
      teamData.shortName = teamData.shortName.trim()
    }

    if (req.file) {
      teamData.logo = `/api/uploads/${req.file.filename}`
    } else if (teamData.logo && (teamData.logo.startsWith('http://') || teamData.logo.startsWith('https://'))) {
      teamData.logo = await downloadImageFromUrl(teamData.logo)
    }
    const team = await teamService.createTeam(teamData)
    res.status(201).json(team)
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
}

export const updateTeam = async (req: Request, res: Response) => {
  try {
    const teamData = req.body
    if (teamData.name !== undefined && (!teamData.name || typeof teamData.name !== 'string' || !teamData.name.trim())) {
      res.status(400).json({ error: 'Team name cannot be empty' })
      return
    }
    if (teamData.name && typeof teamData.name === 'string') {
      teamData.name = teamData.name.trim()
    }
    if (teamData.shortName && typeof teamData.shortName === 'string') {
      teamData.shortName = teamData.shortName.trim()
    }

    const existing = await teamService.getTeamById(req.params.id as string)

    if (req.file) {
      // New logo uploaded — delete the old one first
      if (existing?.logo) deleteUploadedFile(existing.logo)
      teamData.logo = `/api/uploads/${req.file.filename}`
    } else if (teamData.logo && (teamData.logo.startsWith('http://') || teamData.logo.startsWith('https://'))) {
      if (existing?.logo) deleteUploadedFile(existing.logo)
      teamData.logo = await downloadImageFromUrl(teamData.logo)
    } else if (teamData.logo === '' || teamData.logo === null) {
      if (existing?.logo) deleteUploadedFile(existing.logo)
      teamData.logo = ''
    } else if (teamData.logo && existing?.logo && teamData.logo !== existing.logo) {
      deleteUploadedFile(existing.logo)
    }
    const team = await teamService.updateTeam(req.params.id as string, teamData)
    if (!team) return res.status(404).json({ error: 'Team not found' })
    res.json(team)
    return
  } catch (error: any) {
    res.status(400).json({ error: error.message })
    return
  }
}

export const deleteTeam = async (req: Request, res: Response) => {
  try {
    const team = await teamService.getTeamById(req.params.id as string)
    if (team?.logo) deleteUploadedFile(team.logo)

    if (req.query.deletePlayers === 'true') {
      // Also delete every player avatar for this team
      const players = await playerRepo.getPlayers()
      for (const p of players.filter((p) => p.team === req.params.id)) {
        if (p.avatar) deleteUploadedFile(p.avatar)
      }
      await teamService.deleteTeamWithPlayers(req.params.id as string)
    } else {
      await teamService.deleteTeam(req.params.id as string)
    }
    res.status(204).send()
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
}
