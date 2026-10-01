<script setup lang="ts">
const props = withDefaults(defineProps<{
  modelValue?: string | number;
  label?: string;
  placeholder?: string;
  type?: 'text' | 'number' | 'email' | 'password' | 'search' | 'url';
  disabled?: boolean;
  error?: string;
  hint?: string;
  size?: 'lg' | 'md' | 'sm';
  trimOnPaste?: boolean;
}>(), {
  type: 'text',
  disabled: false,
  size: 'md',
  trimOnPaste: true,
});

const emit = defineEmits<{
  'update:modelValue': [value: string | number];
}>();

const handlePaste = (e: ClipboardEvent) => {
  if (!props.trimOnPaste || props.type === 'password') return;
  const clipboardData = e.clipboardData;
  if (!clipboardData) return;

  const rawText = clipboardData.getData('text');
  if (!rawText) return;

  const cleaned = rawText.replace(/[\r\n\t]+/g, ' ').trim();
  if (cleaned !== rawText) {
    e.preventDefault();
    const input = e.target as HTMLInputElement;
    const inserted = document.execCommand?.('insertText', false, cleaned);
    if (inserted) {
      emit('update:modelValue', props.type === 'number' ? (input.value === '' ? '' : Number(input.value)) : input.value);
    } else {
      const start = input.selectionStart ?? 0;
      const end = input.selectionEnd ?? 0;
      const currentVal = input.value || '';
      const nextVal = currentVal.slice(0, start) + cleaned + currentVal.slice(end);
      input.value = nextVal;
      input.setSelectionRange(start + cleaned.length, start + cleaned.length);
      emit('update:modelValue', props.type === 'number' ? (nextVal === '' ? '' : Number(nextVal)) : nextVal);
    }
  }
};

const handleDrop = (e: DragEvent) => {
  if (!props.trimOnPaste || props.type === 'password') return;
  const rawText = e.dataTransfer?.getData('text');
  if (!rawText) return;

  const cleaned = rawText.replace(/[\r\n\t]+/g, ' ').trim();
  if (cleaned !== rawText) {
    e.preventDefault();
    const input = e.target as HTMLInputElement;
    const inserted = document.execCommand?.('insertText', false, cleaned);
    if (inserted) {
      emit('update:modelValue', props.type === 'number' ? (input.value === '' ? '' : Number(input.value)) : input.value);
    } else {
      const start = input.selectionStart ?? 0;
      const end = input.selectionEnd ?? 0;
      const currentVal = input.value || '';
      const nextVal = currentVal.slice(0, start) + cleaned + currentVal.slice(end);
      input.value = nextVal;
      input.setSelectionRange(start + cleaned.length, start + cleaned.length);
      emit('update:modelValue', props.type === 'number' ? (nextVal === '' ? '' : Number(nextVal)) : nextVal);
    }
  }
};
</script>

<template>
  <div class="w-full">
    <!-- Label -->
    <label v-if="label" class="block text-xs font-semibold text-zinc-400 mb-1.5">
      {{ label }}
    </label>

    <!-- Input -->
    <input
      :value="modelValue"
      :type="type"
      :disabled="disabled"
      :placeholder="placeholder"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @paste="handlePaste"
      @drop="handleDrop"
      :class="[
        'w-full bg-surface border rounded-lg text-text-main focus:outline-none transition-colors',
        'placeholder:text-zinc-600',
        // Size
        size === 'lg' && 'px-4 py-3 text-base',
        size === 'md' && 'px-3 py-2 text-sm',
        size === 'sm' && 'px-2.5 py-1.5 text-xs',
        // Border color
        error ? 'border-red-900/50 focus:border-red-600' : 'border-zinc-700 focus:border-primary',
        // Disabled
        disabled && 'opacity-50 cursor-not-allowed',
      ]"
    />

    <!-- Error message -->
    <p v-if="error" class="mt-1.5 text-xs text-red-400">{{ error }}</p>

    <!-- Hint text -->
    <p v-else-if="hint" class="mt-1.5 text-xs text-zinc-500">{{ hint }}</p>
  </div>
</template>
