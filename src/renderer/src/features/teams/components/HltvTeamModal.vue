<script setup lang="ts">
import { ref, watch } from 'vue'
import BaseModal from '../../../components/base/BaseModal.vue'
import BaseInput from '../../../components/base/BaseInput.vue'
import BaseButton from '../../../components/base/BaseButton.vue'
import { API_URL } from '../../../index'

const props = defineProps<{
  isOpen: boolean
}>()

const emit = defineEmits<{
  close: []
  extractSuccess: [data: any]
}>()

const hltvUrl = ref('')
const isLoading = ref(false)
const errorMessage = ref('')

watch(
  () => props.isOpen,
  (val) => {
    if (val) {
      hltvUrl.value = ''
      errorMessage.value = ''
      isLoading.value = false
    }
  }
)

const handleExtract = async () => {
  const url = hltvUrl.value.trim()
  if (!url || isLoading.value) return

  if (!url.toLowerCase().includes('hltv.org/team/')) {
    errorMessage.value = 'Please enter a valid HLTV team URL (e.g. https://www.hltv.org/team/9565/vitality)'
    return
  }

  isLoading.value = true
  errorMessage.value = ''

  try {
    // If running in Electron with IPC available
    if (typeof (window as any).api?.scrapeHltvTeam === 'function') {
      const data = await (window as any).api.scrapeHltvTeam(url)
      emit('extractSuccess', data)
      emit('close')
      return
    }

    const res = await fetch(`${API_URL}/teams/from-hltv`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url })
    })

    const contentType = res.headers.get('content-type') || ''
    let data: any
    if (contentType.includes('application/json')) {
      data = await res.json()
    } else {
      if (res.status === 404) {
        throw new Error(
          'Backend route not found (404). Please restart the Electron app (close the window and restart npm run dev) so the new backend route is loaded.'
        )
      }
      const text = await res.text()
      throw new Error(`Server error (${res.status}): ${text.slice(0, 100)}`)
    }

    if (!res.ok) {
      throw new Error(data?.error || 'Failed to extract team from HLTV')
    }

    emit('extractSuccess', data)
    emit('close')
  } catch (err: any) {
    errorMessage.value = err.message || 'An error occurred while extracting team data.'
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <BaseModal
    :is-open="isOpen"
    title="Extract from HLTV (experimental)"
    max-width-class="max-w-lg"
    form-id="hltvTeamForm"
    submit-text="Extract Data"
    :submit-disabled="!hltvUrl.trim()"
    :is-submitting="isLoading"
    @close="!isLoading && $emit('close')"
    @cancel="!isLoading && $emit('close')"
  >
    <form id="hltvTeamForm" @submit.prevent="handleExtract" class="p-6 space-y-4">
      <BaseInput
        v-model="hltvUrl"
        label="HLTV Team URL"
        placeholder="https://www.hltv.org/team/9565/vitality"
        type="text"
        size="md"
        :disabled="isLoading"
        :autofocus="true"
      />

      <div
        v-if="errorMessage"
        class="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400 flex items-start gap-2"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="size-4 shrink-0 mt-0.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <span>{{ errorMessage }}</span>
      </div>

      <div
        v-if="isLoading"
        class="p-3 rounded-lg bg-primary/10 border border-primary/20 text-xs text-primary flex items-center gap-2.5"
      >
        <svg
          class="animate-spin size-4 shrink-0 text-primary"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path
            class="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
        <span>Extracting team data from HLTV... This may take a few seconds.</span>
      </div>
    </form>

    <template #footer>
      <BaseButton
        variant="secondary"
        :disabled="isLoading"
        class="flex-1 justify-center"
        @click="$emit('close')"
      >
        Cancel
      </BaseButton>
      <BaseButton
        form="hltvTeamForm"
        type="submit"
        variant="primary"
        class="flex-1 justify-center"
        :disabled="!hltvUrl.trim() || isLoading"
      >
        <span v-if="isLoading" class="flex items-center justify-center gap-2">
          <svg class="animate-spin size-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>Extracting...</span>
        </span>
        <span v-else>Extract Data</span>
      </BaseButton>
    </template>
  </BaseModal>
</template>
