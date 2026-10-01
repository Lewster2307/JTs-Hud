import { ref } from 'vue'
import { API_URL } from '../../../index'

export interface AppSettings {
  autoSwitchSides: boolean
}

const DEFAULT_PAGE_SIZE_STORAGE_KEY = 'app-default-page-size'

const loadDefaultPageSize = (): number => {
  try {
    const saved = localStorage.getItem(DEFAULT_PAGE_SIZE_STORAGE_KEY)
    if (saved) {
      const n = Number(saved)
      if ([10, 25, 50, 100].includes(n)) return n
    }
  } catch {
    /* ignore */
  }
  return 10
}

const defaultPageSize = ref<number>(loadDefaultPageSize())

const setDefaultPageSize = (size: number) => {
  defaultPageSize.value = size
  try {
    localStorage.setItem(DEFAULT_PAGE_SIZE_STORAGE_KEY, String(size))
  } catch {
    /* ignore */
  }
}

const settings = ref<AppSettings>({
  autoSwitchSides: true
})
const isLoading = ref(false)
const isSaving = ref(false)
let fetched = false

export function useSettings() {
  const fetchSettings = async (force = false) => {
    if (fetched && !force) return
    isLoading.value = true
    try {
      const res = await fetch(`${API_URL}/settings`)
      if (res.ok) {
        settings.value = await res.json()
        fetched = true
      }
    } catch (err) {
      console.error('Failed to fetch settings:', err)
    } finally {
      isLoading.value = false
    }
  }

  const saveSettings = async (updates: Partial<AppSettings>) => {
    isSaving.value = true
    try {
      const res = await fetch(`${API_URL}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })
      if (res.ok) settings.value = await res.json()
    } catch (err) {
      console.error('Failed to save settings:', err)
    } finally {
      isSaving.value = false
    }
  }

  return {
    settings,
    defaultPageSize,
    setDefaultPageSize,
    isLoading,
    isSaving,
    fetchSettings,
    saveSettings
  }
}
