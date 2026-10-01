<script setup lang="ts">
import { ref, onMounted } from 'vue'
import BaseButton from '../components/base/BaseButton.vue'
import { API_URL } from '../index'

const teamsCount = ref<number | null>(null)
const playersCount = ref<number | null>(null)
const isLoadingCounts = ref(false)

const isExporting = ref(false)
const exportError = ref<string | null>(null)

const selectedFile = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const isDragging = ref(false)
const isImporting = ref(false)
const importError = ref<string | null>(null)

interface ImportResultStats {
  teams: { total: number; created: number; updated: number; skipped: number }
  players: { total: number; created: number; updated: number; skipped: number }
}

const importSuccessStats = ref<ImportResultStats | null>(null)

// Conflict resolution modal state
const showConflictModal = ref(false)
const conflicts = ref<{ teams: string[]; players: string[] }>({ teams: [], players: [] })
const teamConflictStrategy = ref<'overwrite' | 'skip'>('overwrite')
const playerConflictStrategy = ref<'overwrite' | 'skip'>('overwrite')

const fetchStats = async () => {
  isLoadingCounts.value = true
  try {
    const [teamsRes, playersRes] = await Promise.all([
      fetch(`${API_URL}/teams`),
      fetch(`${API_URL}/players`)
    ])
    if (teamsRes.ok) {
      const teams = await teamsRes.json()
      teamsCount.value = teams.length
    }
    if (playersRes.ok) {
      const players = await playersRes.json()
      playersCount.value = players.length
    }
  } catch (err) {
    console.error('Failed to load database stats:', err)
  } finally {
    isLoadingCounts.value = false
  }
}

onMounted(() => {
  fetchStats()
})

const handleExport = async () => {
  isExporting.value = true
  exportError.value = null
  try {
    const res = await fetch(`${API_URL}/backup/export`)
    if (!res.ok) {
      const errJson = await res.json().catch(() => null)
      throw new Error(errJson?.error || `Export failed with status ${res.status}`)
    }

    const blob = await res.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    a.download = `jts-hud-backup-${dateStr}.zip`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.URL.revokeObjectURL(url)
  } catch (err: any) {
    exportError.value = err?.message || 'Failed to export backup archive.'
  } finally {
    isExporting.value = false
  }
}

const onFileSelected = (event: Event) => {
  const target = event.target as HTMLInputElement
  if (target.files && target.files.length > 0) {
    const file = target.files[0]
    if (file.name.toLowerCase().endsWith('.zip')) {
      selectedFile.value = file
      importError.value = null
      importSuccessStats.value = null
    } else {
      importError.value = 'Please select a valid .zip file.'
      selectedFile.value = null
    }
  }
}

const handleDrop = (event: DragEvent) => {
  isDragging.value = false
  if (event.dataTransfer && event.dataTransfer.files.length > 0) {
    const file = event.dataTransfer.files[0]
    if (file.name.toLowerCase().endsWith('.zip')) {
      selectedFile.value = file
      importError.value = null
      importSuccessStats.value = null
    } else {
      importError.value = 'Please drop a valid .zip file.'
      selectedFile.value = null
    }
  }
}

const triggerFileInput = () => {
  fileInput.value?.click()
}

const clearSelectedFile = () => {
  selectedFile.value = null
  if (fileInput.value) {
    fileInput.value.value = ''
  }
}

const startImportInspection = async () => {
  if (!selectedFile.value) return

  isImporting.value = true
  importError.value = null
  importSuccessStats.value = null

  try {
    const formData = new FormData()
    formData.append('file', selectedFile.value)

    const inspectRes = await fetch(`${API_URL}/backup/inspect`, {
      method: 'POST',
      body: formData
    })

    const inspectData = await inspectRes.json().catch(() => null)

    if (!inspectRes.ok || !inspectData?.valid) {
      throw new Error(inspectData?.error || `Failed to inspect backup file (${inspectRes.status})`)
    }

    const hasTeamConflicts = inspectData.conflicts?.teams?.length > 0
    const hasPlayerConflicts = inspectData.conflicts?.players?.length > 0

    if (hasTeamConflicts || hasPlayerConflicts) {
      conflicts.value = {
        teams: inspectData.conflicts.teams || [],
        players: inspectData.conflicts.players || []
      }
      teamConflictStrategy.value = 'overwrite'
      playerConflictStrategy.value = 'overwrite'
      showConflictModal.value = true
      isImporting.value = false
      return
    }

    // No conflicts, execute directly
    await executeImport('overwrite', 'overwrite')
  } catch (err: any) {
    importError.value = err?.message || 'Failed to inspect backup archive.'
    isImporting.value = false
  }
}

const executeImport = async (
  teamStrategy: 'overwrite' | 'skip',
  playerStrategy: 'overwrite' | 'skip'
) => {
  if (!selectedFile.value) return

  showConflictModal.value = false
  isImporting.value = true
  importError.value = null
  importSuccessStats.value = null

  try {
    const formData = new FormData()
    formData.append('file', selectedFile.value)
    formData.append('teamConflictStrategy', teamStrategy)
    formData.append('playerConflictStrategy', playerStrategy)

    const res = await fetch(`${API_URL}/backup/import`, {
      method: 'POST',
      body: formData
    })

    const data = await res.json().catch(() => null)

    if (!res.ok || !data?.success) {
      throw new Error(data?.error || `Import failed with status ${res.status}`)
    }

    importSuccessStats.value = {
      teams: data.teams,
      players: data.players
    }
    clearSelectedFile()
    await fetchStats()
  } catch (err: any) {
    importError.value = err?.message || 'Failed to import backup archive.'
  } finally {
    isImporting.value = false
  }
}

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}
</script>

<template>
  <div class="p-6 bg-surface text-zinc-200 min-h-screen">
    <!-- Header -->
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-text-main tracking-tight">Import / Export</h1>
      <p class="text-zinc-400 text-sm mt-1">
        Backup and restore all teams, players, team assignments, and media files in a single unified ZIP archive.
      </p>
    </div>

    <!-- Quick Stats -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
      <div class="bg-zinc-800/60 border border-zinc-700/60 rounded-xl p-4 flex items-center justify-between">
        <div>
          <p class="text-xs uppercase tracking-wider text-zinc-400 font-semibold">Total Teams</p>
          <p class="text-2xl font-bold text-text-main mt-1">
            <span v-if="isLoadingCounts" class="text-zinc-500 animate-pulse">...</span>
            <span v-else>{{ teamsCount ?? 0 }}</span>
          </p>
        </div>
        <div class="size-10 rounded-lg bg-zinc-700/50 flex items-center justify-center text-zinc-300">
          <svg xmlns="http://www.w3.org/2000/svg" height="22px" viewBox="0 -960 960 960" width="22px" fill="currentColor">
            <path d="M40-240q-17 0-28.5-11.5T0-280v-23q0-43 44-70t116-27q13 0 25 .5t23 2.5q-14 21-21 44t-7 48v65H40Zm240 0q-17 0-28.5-11.5T240-280v-25q0-32 17.5-58.5T307-410q32-20 76.5-30t96.5-10q53 0 97.5 10t76.5 30q32 20 49 46.5t17 58.5v25q0 17-11.5 28.5T680-240H280Zm500 0v-65q0-26-6.5-49T754-397q11-2 22.5-2.5t23.5-.5q72 0 116 26.5t44 70.5v23q0 17-11.5 28.5T920-240H780Zm-455-80h311q-10-20-55.5-35T480-370q-55 0-100.5 15T325-320ZM160-440q-33 0-56.5-23.5T80-520q0-34 23.5-57t56.5-23q34 0 57 23t23 57q0 33-23 56.5T160-440Zm640 0q-33 0-56.5-23.5T720-520q0-34 23.5-57t56.5-23q34 0 57 23t23 57q0 33-23 56.5T800-440Zm-320-40q-50 0-85-35t-35-85q0-51 35-85.5t85-34.5q51 0 85.5 34.5T600-600q0 50-34.5 85T480-480Zm0-80q17 0 28.5-11.5T520-600q0-17-11.5-28.5T480-640q-17 0-28.5 11.5T440-600q0 17 11.5 28.5T480-560Zm1 240Zm-1-280Z"/>
          </svg>
        </div>
      </div>

      <div class="bg-zinc-800/60 border border-zinc-700/60 rounded-xl p-4 flex items-center justify-between">
        <div>
          <p class="text-xs uppercase tracking-wider text-zinc-400 font-semibold">Total Players</p>
          <p class="text-2xl font-bold text-text-main mt-1">
            <span v-if="isLoadingCounts" class="text-zinc-500 animate-pulse">...</span>
            <span v-else>{{ playersCount ?? 0 }}</span>
          </p>
        </div>
        <div class="size-10 rounded-lg bg-zinc-700/50 flex items-center justify-center text-zinc-300">
          <svg xmlns="http://www.w3.org/2000/svg" height="22px" viewBox="0 -960 960 960" width="22px" fill="currentColor">
            <path d="M367-527q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47ZM160-240v-32q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v32q0 33-23.5 56.5T720-160H240q-33 0-56.5-23.5T160-240Zm80 0h480v-32q0-11-5.5-20T700-306q-54-27-109-40.5T480-360q-56 0-111 13.5T260-306q-9 5-14.5 14t-5.5 20v32Zm296.5-343.5Q560-607 560-640t-23.5-56.5Q513-720 480-720t-56.5 23.5Q400-673 400-640t23.5 56.5Q447-560 480-560t56.5-23.5ZM480-640Zm0 400Z"/>
          </svg>
        </div>
      </div>
    </div>

    <!-- Main Cards Grid -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Export Card -->
      <div class="bg-zinc-850 border border-zinc-750 rounded-xl p-6 flex flex-col justify-between">
        <div>
          <div class="flex items-center gap-3 mb-3">
            <div class="size-9 rounded-lg bg-primary/20 text-primary flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </div>
            <div>
              <h2 class="text-lg font-bold text-text-main">Export Archive</h2>
              <p class="text-xs text-zinc-400">Download complete database backup</p>
            </div>
          </div>

          <p class="text-sm text-zinc-300 mb-4 leading-relaxed">
            Packages all current teams and players into a single <code class="text-primary font-mono text-xs">.zip</code> archive.
            All team-player associations, custom logos, and player photos are included and organized within the package.
          </p>

          <div class="bg-zinc-800/80 border border-zinc-700/60 rounded-lg p-3.5 mb-6 text-xs text-zinc-300 space-y-2">
            <p class="font-semibold text-zinc-200">Included in the ZIP file:</p>
            <ul class="list-disc list-inside space-y-1 text-zinc-400">
              <li><span class="text-zinc-200 font-mono">data.json</span> — Team & Player records and relation map</li>
              <li><span class="text-zinc-200 font-mono">images/teams/</span> — All team logo files</li>
              <li><span class="text-zinc-200 font-mono">images/players/</span> — All player avatar files</li>
            </ul>
          </div>

          <div v-if="exportError" class="p-3 mb-4 rounded-lg bg-red-950/50 border border-red-800/60 text-red-300 text-xs">
            {{ exportError }}
          </div>
        </div>

        <div class="pt-4 border-t border-zinc-800 flex justify-end">
          <BaseButton
            variant="primary"
            :disabled="isExporting"
            @click="handleExport"
          >
            <div v-if="isExporting" class="size-4 border-2 border-zinc-400 border-t-white rounded-full animate-spin"></div>
            <svg v-else xmlns="http://www.w3.org/2000/svg" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {{ isExporting ? 'Generating ZIP...' : 'Export All (.zip)' }}
          </BaseButton>
        </div>
      </div>

      <!-- Import Card -->
      <div class="bg-zinc-850 border border-zinc-750 rounded-xl p-6 flex flex-col justify-between">
        <div>
          <div class="flex items-center gap-3 mb-3">
            <div class="size-9 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            </div>
            <div>
              <h2 class="text-lg font-bold text-text-main">Import Archive</h2>
              <p class="text-xs text-zinc-400">Restore or merge teams & players</p>
            </div>
          </div>

          <p class="text-sm text-zinc-300 mb-4 leading-relaxed">
            Upload an exported <code class="text-emerald-400 font-mono text-xs">.zip</code> archive.
            Team names and player usernames are unique. If duplicates exist, you can choose to overwrite them or skip them.
          </p>

          <!-- Hidden File Input -->
          <input
            ref="fileInput"
            type="file"
            accept=".zip"
            class="hidden"
            @change="onFileSelected"
          />

          <!-- Drag and Drop Zone -->
          <div
            class="border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors mb-4"
            :class="[
              isDragging
                ? 'border-emerald-400 bg-emerald-950/20'
                : 'border-zinc-700 hover:border-zinc-500 bg-zinc-800/40'
            ]"
            @click="triggerFileInput"
            @dragover.prevent="isDragging = true"
            @dragleave.prevent="isDragging = false"
            @drop.prevent="handleDrop"
          >
            <div class="flex flex-col items-center justify-center gap-2">
              <div class="size-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400">
                <svg xmlns="http://www.w3.org/2000/svg" class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <p class="text-sm font-medium text-text-main">
                Click to browse or drag & drop a ZIP file here
              </p>
              <p class="text-xs text-zinc-400">Maximum file size: 150MB</p>
            </div>
          </div>

          <!-- Selected File Details -->
          <div
            v-if="selectedFile"
            class="bg-zinc-800/90 border border-zinc-700 rounded-lg p-3 mb-4 flex items-center justify-between"
          >
            <div class="flex items-center gap-2.5 overflow-hidden">
              <svg xmlns="http://www.w3.org/2000/svg" class="size-5 text-emerald-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <div class="truncate">
                <p class="text-xs font-semibold text-text-main truncate">{{ selectedFile.name }}</p>
                <p class="text-[11px] text-zinc-400">{{ formatBytes(selectedFile.size) }}</p>
              </div>
            </div>
            <button
              @click.stop="clearSelectedFile"
              class="text-zinc-500 hover:text-red-400 p-1 rounded transition-colors"
              title="Remove file"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Error Alert -->
          <div v-if="importError" class="p-3 mb-4 rounded-lg bg-red-950/50 border border-red-800/60 text-red-300 text-xs">
            {{ importError }}
          </div>

          <!-- Success Alert -->
          <div v-if="importSuccessStats" class="p-4 mb-4 rounded-lg bg-emerald-950/50 border border-emerald-800/60 text-emerald-300 text-xs space-y-2">
            <div class="flex items-center gap-2 font-semibold text-sm">
              <svg xmlns="http://www.w3.org/2000/svg" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span>Import completed successfully</span>
            </div>
            <div class="grid grid-cols-2 gap-2 pt-1 border-t border-emerald-900/60 text-zinc-300">
              <div class="bg-zinc-900/60 p-2 rounded">
                <p class="font-semibold text-emerald-400">Teams ({{ importSuccessStats.teams.total }} total)</p>
                <p class="text-[11px] text-zinc-400 mt-0.5">
                  Added: {{ importSuccessStats.teams.created }} | Updated: {{ importSuccessStats.teams.updated }} | Skipped: {{ importSuccessStats.teams.skipped }}
                </p>
              </div>
              <div class="bg-zinc-900/60 p-2 rounded">
                <p class="font-semibold text-emerald-400">Players ({{ importSuccessStats.players.total }} total)</p>
                <p class="text-[11px] text-zinc-400 mt-0.5">
                  Added: {{ importSuccessStats.players.created }} | Updated: {{ importSuccessStats.players.updated }} | Skipped: {{ importSuccessStats.players.skipped }}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div class="pt-4 border-t border-zinc-800 flex justify-end">
          <BaseButton
            variant="primary"
            :disabled="!selectedFile || isImporting"
            @click="startImportInspection"
          >
            <div v-if="isImporting" class="size-4 border-2 border-zinc-400 border-t-white rounded-full animate-spin"></div>
            <svg v-else xmlns="http://www.w3.org/2000/svg" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            {{ isImporting ? 'Processing Archive...' : 'Start Import' }}
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- Conflict Resolution Modal -->
    <div
      v-if="showConflictModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div class="bg-zinc-850 rounded-xl border border-zinc-700 w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <!-- Modal Header -->
        <div class="p-5 border-b border-zinc-700 flex justify-between items-center bg-zinc-800/80">
          <div class="flex items-center gap-2.5">
            <div class="size-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h2 class="text-lg font-bold text-text-main">Duplicates Detected</h2>
              <p class="text-xs text-zinc-400">Choose how to handle existing teams and players</p>
            </div>
          </div>
          <button
            @click="showConflictModal = false"
            class="text-zinc-500 hover:text-zinc-300 p-1 rounded transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Modal Body -->
        <div class="p-6 space-y-5 overflow-y-auto flex-1">
          <p class="text-sm text-zinc-300">
            Some items in the backup archive already exist in your database. Select whether you want to overwrite them with the backup data or keep your current data.
          </p>

          <!-- Teams Conflict Section -->
          <div v-if="conflicts.teams.length > 0" class="bg-zinc-800/80 border border-zinc-700/80 rounded-xl p-4 space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-semibold text-text-main">Duplicate Teams ({{ conflicts.teams.length }})</p>
                <p class="text-xs text-zinc-400">Matching team name</p>
              </div>
              <div class="flex items-center gap-1 bg-zinc-900/80 p-1 rounded-lg border border-zinc-700">
                <button
                  type="button"
                  @click="teamConflictStrategy = 'overwrite'"
                  class="px-3 py-1 rounded text-xs font-semibold transition-colors"
                  :class="[
                    teamConflictStrategy === 'overwrite'
                      ? 'bg-primary text-text-main shadow'
                      : 'text-zinc-400 hover:text-zinc-200'
                  ]"
                >
                  Overwrite
                </button>
                <button
                  type="button"
                  @click="teamConflictStrategy = 'skip'"
                  class="px-3 py-1 rounded text-xs font-semibold transition-colors"
                  :class="[
                    teamConflictStrategy === 'skip'
                      ? 'bg-zinc-700 text-text-main shadow'
                      : 'text-zinc-400 hover:text-zinc-200'
                  ]"
                >
                  Skip
                </button>
              </div>
            </div>

            <!-- List conflicting teams -->
            <div class="max-h-24 overflow-y-auto bg-zinc-900/60 rounded-lg p-2 flex flex-wrap gap-1.5 border border-zinc-800">
              <span
                v-for="name in conflicts.teams"
                :key="name"
                class="px-2 py-0.5 rounded bg-zinc-800 text-xs text-zinc-300 border border-zinc-700"
              >
                {{ name }}
              </span>
            </div>
          </div>

          <!-- Players Conflict Section -->
          <div v-if="conflicts.players.length > 0" class="bg-zinc-800/80 border border-zinc-700/80 rounded-xl p-4 space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-semibold text-text-main">Duplicate Players ({{ conflicts.players.length }})</p>
                <p class="text-xs text-zinc-400">Matching username</p>
              </div>
              <div class="flex items-center gap-1 bg-zinc-900/80 p-1 rounded-lg border border-zinc-700">
                <button
                  type="button"
                  @click="playerConflictStrategy = 'overwrite'"
                  class="px-3 py-1 rounded text-xs font-semibold transition-colors"
                  :class="[
                    playerConflictStrategy === 'overwrite'
                      ? 'bg-primary text-text-main shadow'
                      : 'text-zinc-400 hover:text-zinc-200'
                  ]"
                >
                  Overwrite
                </button>
                <button
                  type="button"
                  @click="playerConflictStrategy = 'skip'"
                  class="px-3 py-1 rounded text-xs font-semibold transition-colors"
                  :class="[
                    playerConflictStrategy === 'skip'
                      ? 'bg-zinc-700 text-text-main shadow'
                      : 'text-zinc-400 hover:text-zinc-200'
                  ]"
                >
                  Skip
                </button>
              </div>
            </div>

            <!-- List conflicting players -->
            <div class="max-h-24 overflow-y-auto bg-zinc-900/60 rounded-lg p-2 flex flex-wrap gap-1.5 border border-zinc-800">
              <span
                v-for="uname in conflicts.players"
                :key="uname"
                class="px-2 py-0.5 rounded bg-zinc-800 text-xs text-zinc-300 border border-zinc-700"
              >
                {{ uname }}
              </span>
            </div>
          </div>
        </div>

        <!-- Modal Footer -->
        <div class="p-5 border-t border-zinc-700 bg-zinc-800/80 flex items-center justify-between gap-3">
          <BaseButton @click="showConflictModal = false" variant="ghost">
            Cancel
          </BaseButton>

          <div class="flex items-center gap-2">
            <BaseButton
              variant="secondary"
              @click="executeImport('skip', 'skip')"
            >
              Skip All Duplicates
            </BaseButton>
            <BaseButton
              variant="primary"
              @click="executeImport(teamConflictStrategy, playerConflictStrategy)"
            >
              Proceed Import
            </BaseButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
