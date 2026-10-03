import { Router } from 'express'
import { upload } from '../../utils/multer'
import {
  getTeams,
  getTeamLogo,
  getTeamById,
  createTeam,
  updateTeam,
  deleteTeam,
  extractHltvTeam
} from './team.controller'

const router = Router()

router.get('/', getTeams)
router.get('/logo/:id', getTeamLogo) // must be before /:id to avoid conflict
router.post('/from-hltv', extractHltvTeam)
router.get('/:id', getTeamById)
router.post('/', upload.single('logo'), createTeam)
router.put('/:id', upload.single('logo'), updateTeam)
router.delete('/:id', deleteTeam)

export default router
