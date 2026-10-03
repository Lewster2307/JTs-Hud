import { ref, computed, onMounted } from 'vue'
import { useTeams } from './useTeams'
import { usePlayers } from '../../players/composables/usePlayers'
import { getCountry } from '../../../utils/countries'

const TABLE_HEADERS = [
  { key: 'logo', label: 'Logo' },
  { key: 'name', label: 'Team Name', sortable: true },
  { key: 'shortName', label: 'Abbreviation', sortable: true },
  { key: 'country', label: 'Country', sortable: true },
  { key: 'playerCount', label: 'Players', sortable: true }
]

const getEmptyForm = () => ({ name: '', shortName: '', country: '', logo: '', extra: {} })

const TEAMS_SORT_STORAGE_KEY = 'teams-table-sort'

export function useTeamsView() {
  const { teams, isLoading, fetchTeams, saveTeam, deleteTeam, deleteManyTeams } = useTeams()
  const { players, fetchPlayers } = usePlayers()

  // --- Sort ---
  const getInitialSort = () => {
    try {
      const saved = localStorage.getItem(TEAMS_SORT_STORAGE_KEY) || localStorage.getItem('teams-table-columns-sort')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed && typeof parsed.key === 'string' && TABLE_HEADERS.some(h => h.key === parsed.key && h.sortable)) {
          return {
            key: parsed.key,
            dir: (parsed.dir === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc'
          }
        }
      }
    } catch {
      /* ignore */
    }
    return { key: 'name', dir: 'asc' as const }
  }

  const initialSort = getInitialSort()
  const sortKey = ref(initialSort.key)
  const sortDir = ref<'asc' | 'desc'>(initialSort.dir)

  const handleSort = ({ key, dir }: { key: string; dir: 'asc' | 'desc' }) => {
    sortKey.value = key
    sortDir.value = dir
    try {
      localStorage.setItem(TEAMS_SORT_STORAGE_KEY, JSON.stringify({ key, dir }))
      localStorage.setItem('teams-table-columns-sort', JSON.stringify({ key, dir }))
    } catch {
      /* ignore */
    }
  }

  const sortedTeams = computed(() => {
    const list = teams.value.map((t) => ({
      ...t,
      countryName: getCountry(t.country),
      playerCount: players.value.filter((p) => p.team === t._id).length
    }))
    const dir = sortDir.value === 'asc' ? 1 : -1
    return list.sort((a, b) => {
      if (sortKey.value === 'playerCount') {
        const aCount = a.playerCount
        const bCount = b.playerCount
        if (aCount !== bCount) return (aCount - bCount) * dir
      } else {
        const aVal = String(a[sortKey.value] ?? '')
        const bVal = String(b[sortKey.value] ?? '')
        const cmp = aVal.localeCompare(bVal, undefined, { sensitivity: 'base', numeric: true })
        if (cmp !== 0) return cmp * dir
      }
      // Tie breaker by team name
      const aName = String(a.name ?? '')
      const bName = String(b.name ?? '')
      return aName.localeCompare(bName, undefined, { sensitivity: 'base', numeric: true })
    })
  })

  // --- Selection ---
  const selectedTeamIds = ref<string[]>([])

  const handleSelectionChange = (ids: string[]) => {
    selectedTeamIds.value = ids
  }

  const handleDeleteSelected = async () => {
    await deleteManyTeams(selectedTeamIds.value)
    selectedTeamIds.value = []
  }

  const handleDeleteAll = async () => {
    await deleteManyTeams(teams.value.map((t) => t._id))
    selectedTeamIds.value = []
  }

  // --- Modal ---
  const isModalOpen = ref(false)
  const isEditing = ref(false)
  const editingId = ref<string | null>(null)
  const formData = ref(getEmptyForm())

  const handleSave = async (payload: any, file: File | null) => {
    await saveTeam(payload, isEditing.value ? editingId.value : null, file)
    isModalOpen.value = false
  }

  const openCreateModal = () => {
    isEditing.value = false
    editingId.value = null
    formData.value = getEmptyForm()
    isModalOpen.value = true
  }

  const openEditModal = (team: any) => {
    isEditing.value = true
    editingId.value = team._id
    formData.value = { ...team }
    isModalOpen.value = true
  }

  onMounted(() => {
    fetchTeams()
    fetchPlayers()
  })

  return {
    // Data
    teams,
    players,
    isLoading,
    sortedTeams,
    tableHeaders: TABLE_HEADERS,
    // Sort
    sortKey,
    sortDir,
    handleSort,
    // Selection
    selectedTeamIds,
    handleSelectionChange,
    handleDeleteSelected,
    handleDeleteAll,
    // Modal
    isModalOpen,
    isEditing,
    formData,
    handleSave,
    openCreateModal,
    openEditModal,
    // CRUD
    deleteTeam
  }
}
