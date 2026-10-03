import { ref, computed, onMounted } from 'vue'
import { usePlayers } from './usePlayers'
import { useTeams } from '../../teams/composables/useTeams'
import { API_URL } from '../../../index'
import { getCountry } from '../../../utils/countries'

const TABLE_HEADERS = [
  { key: 'avatar', label: 'Photo' },
  { key: 'username', label: 'Username', sortable: true },
  { key: 'firstName', label: 'First Name', sortable: true },
  { key: 'lastName', label: 'Last Name', sortable: true },
  { key: 'team', label: 'Team', sortable: true },
  { key: 'country', label: 'Country', sortable: true },
  { key: 'steamid', label: 'Steam ID', sortable: true }
]

const getEmptyForm = () => ({
  firstName: '',
  lastName: '',
  username: '',
  avatar: '',
  country: '',
  steamid: '',
  team: '',
  isCoach: false,
  extra: {}
})

const PLAYERS_SORT_STORAGE_KEY = 'players-table-sort'

export function usePlayersView() {
  const {
    players,
    isLoading: isPlayersLoading,
    fetchPlayers,
    savePlayer,
    deletePlayer,
    deleteManyPlayers
  } = usePlayers()
  const { teams: availableTeams, fetchTeams } = useTeams()

  // --- Sort ---
  const getInitialSort = () => {
    try {
      const saved = localStorage.getItem(PLAYERS_SORT_STORAGE_KEY) || localStorage.getItem('players-table-columns-sort')
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
    return { key: 'username', dir: 'asc' as const }
  }

  const initialSort = getInitialSort()
  const sortKey = ref(initialSort.key)
  const sortDir = ref<'asc' | 'desc'>(initialSort.dir)

  const handleSort = ({ key, dir }: { key: string; dir: 'asc' | 'desc' }) => {
    sortKey.value = key
    sortDir.value = dir
    try {
      localStorage.setItem(PLAYERS_SORT_STORAGE_KEY, JSON.stringify({ key, dir }))
      localStorage.setItem('players-table-columns-sort', JSON.stringify({ key, dir }))
    } catch {
      /* ignore */
    }
  }

  // --- Team Resolution ---
  const teamMap = computed(() => {
    const map: Record<string, { name: string; logo: string; shortName: string }> = {}
    for (const t of availableTeams.value)
      map[t._id] = { name: t.name, logo: t.logo, shortName: t.shortName }
    return map
  })

  const getTeamName = (teamId: string) => teamMap.value[teamId]?.name ?? ''

  // --- Sorted Players ---
  const sortedPlayers = computed(() => {
    const list = players.value.map((p) => {
      const t = teamMap.value[p.team]
      return {
        ...p,
        teamName: getTeamName(p.team),
        teamShortName: t?.shortName ?? '',
        countryName: getCountry(p.country)
      }
    })
    const dir = sortDir.value === 'asc' ? 1 : -1
    return list.sort((a, b) => {
      let aVal = ''
      let bVal = ''
      if (sortKey.value === 'team') {
        aVal = a.teamName
        bVal = b.teamName

        // Put players without a team at the bottom
        if (!aVal && bVal) return 1
        if (aVal && !bVal) return -1
      } else {
        aVal = String(a[sortKey.value] ?? '')
        bVal = String(b[sortKey.value] ?? '')
      }

      const cmp = aVal.localeCompare(bVal, undefined, { sensitivity: 'base', numeric: true })
      if (cmp !== 0) return cmp * dir

      // Secondary tie-breaker by username
      const aUser = String(a.username ?? '')
      const bUser = String(b.username ?? '')
      return aUser.localeCompare(bUser, undefined, { sensitivity: 'base', numeric: true })
    })
  })

  // --- Selection ---
  const selectedPlayerIds = ref<string[]>([])

  const handleSelectionChange = (ids: string[]) => {
    selectedPlayerIds.value = ids
  }

  const handleDeleteSelected = async () => {
    await deleteManyPlayers(selectedPlayerIds.value)
    selectedPlayerIds.value = []
  }

  const handleDeleteAll = async () => {
    await deleteManyPlayers(players.value.map((p) => p._id))
    selectedPlayerIds.value = []
  }

  // --- Bulk Assign Team Modal ---
  const isAssignTeamModalOpen = ref(false)
  const selectedTeamForAssign = ref<string | null>(null)
  const isAssigningTeam = ref(false)

  const openAssignTeamModal = () => {
    selectedTeamForAssign.value = null
    isAssignTeamModalOpen.value = true
  }

  const handleAssignTeam = async () => {
    if (!selectedPlayerIds.value.length || selectedTeamForAssign.value === null) return
    isAssigningTeam.value = true
    try {
      const targetTeam = selectedTeamForAssign.value
      for (const id of selectedPlayerIds.value) {
        const player = players.value.find((p) => p._id === id)
        if (player) {
          const formData = new FormData()
          const payload = { ...player, team: targetTeam }
          Object.keys(payload).forEach((key) => {
            const value = typeof payload[key] === 'object' ? JSON.stringify(payload[key]) : payload[key]
            formData.append(key, value)
          })
          await fetch(`${API_URL}/players/${id}`, {
            method: 'PUT',
            body: formData
          })
        }
      }
      await fetchPlayers()
      selectedPlayerIds.value = []
      isAssignTeamModalOpen.value = false
    } catch (error) {
      console.error('Failed to assign team to players:', error)
    } finally {
      isAssigningTeam.value = false
    }
  }

  // --- Modal ---
  const isModalOpen = ref(false)
  const isEditing = ref(false)
  const editingId = ref<string | null>(null)
  const formData = ref(getEmptyForm())

  const handleSave = async (payload: any, file: File | null) => {
    await savePlayer(payload, isEditing.value ? editingId.value : null, file)
    isModalOpen.value = false
  }

  const openCreateModal = () => {
    isEditing.value = false
    editingId.value = null
    formData.value = getEmptyForm()
    isModalOpen.value = true
  }

  const openEditModal = (player: any) => {
    isEditing.value = true
    editingId.value = player._id
    formData.value = { ...player, team: player.team ?? '' }
    isModalOpen.value = true
  }

  onMounted(() => {
    fetchPlayers()
    fetchTeams()
  })

  return {
    // Data
    players,
    availableTeams,
    isPlayersLoading,
    sortedPlayers,
    teamMap,
    tableHeaders: TABLE_HEADERS,
    // Sort
    sortKey,
    sortDir,
    handleSort,
    // Selection
    selectedPlayerIds,
    handleSelectionChange,
    handleDeleteSelected,
    handleDeleteAll,
    // Bulk Assign Team
    isAssignTeamModalOpen,
    selectedTeamForAssign,
    isAssigningTeam,
    openAssignTeamModal,
    handleAssignTeam,
    // Modal
    isModalOpen,
    isEditing,
    formData,
    handleSave,
    openCreateModal,
    openEditModal,
    // CRUD
    deletePlayer
  }
}
