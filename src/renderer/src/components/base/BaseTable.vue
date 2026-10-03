<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import BaseButton from './BaseButton.vue';
import { useSettings } from '../../features/settings/composables/useSettings';
import { getCountry } from '../../utils/countries';

const props = withDefaults(defineProps<{
  headers: { key: string; label: string; sortable?: boolean }[];
  items: any[];
  isLoading?: boolean;
  selectable?: boolean;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  defaultPageSize?: number;
  searchPlaceholder?: string;
  searchable?: boolean;
  searchFields?: string[];
  columnToggle?: boolean;
  storageKey?: string;
  stickyHeader?: boolean;
  maxHeight?: string;
}>(), {
  isLoading: false,
  selectable: false,
  sortDir: 'asc',
  searchPlaceholder: 'Search...',
  searchable: true,
  searchFields: () => ['teamName', 'teamShortName'],
  columnToggle: false,
  stickyHeader: true,
  maxHeight: 'calc(100vh - 280px)'
});

const emit = defineEmits<{
  (e: 'edit', item: any): void;
  (e: 'delete', id: string): void;
  (e: 'sort', payload: { key: string; dir: 'asc' | 'desc' }): void;
  (e: 'selection-change', ids: string[]): void;
}>();

const { defaultPageSize } = useSettings();

// --- SEARCH ---
const searchQuery = ref('');

const handleSearchPaste = (e: ClipboardEvent) => {
  const rawText = e.clipboardData?.getData('text');
  if (!rawText) return;
  const cleaned = rawText.replace(/[\r\n\t]+/g, ' ').trim();
  if (cleaned !== rawText) {
    e.preventDefault();
    const input = e.target as HTMLInputElement;
    const inserted = document.execCommand?.('insertText', false, cleaned);
    if (inserted) {
      searchQuery.value = input.value;
    } else {
      const start = input.selectionStart ?? 0;
      const end = input.selectionEnd ?? 0;
      const currentVal = input.value || '';
      const nextVal = currentVal.slice(0, start) + cleaned + currentVal.slice(end);
      input.value = nextVal;
      input.setSelectionRange(start + cleaned.length, start + cleaned.length);
      searchQuery.value = nextVal;
    }
  }
};

const filteredItems = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return props.items;
  const headerKeys = props.headers.map((h) => h.key);
  const extraKeys = props.searchFields || [];
  const searchKeys = [...new Set([...headerKeys, ...extraKeys, 'countryName', 'teamName', 'teamShortName'])];
  return props.items.filter((item) => {
    const matchKey = searchKeys.some((key) => {
      const val = item[key];
      return val != null && String(val).toLowerCase().includes(q);
    });
    if (matchKey) return true;

    if (item.country) {
      const cName = item.countryName || getCountry(item.country);
      if (cName && String(cName).toLowerCase().includes(q)) {
        return true;
      }
    }

    return false;
  });
});

// --- PAGINATION ---
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const pageSize = ref(props.defaultPageSize ?? defaultPageSize.value ?? 10);
const currentPage = ref(1);

watch(defaultPageSize, (newVal) => {
  if (props.defaultPageSize === undefined && newVal) {
    pageSize.value = newVal;
  }
});

watch(() => props.defaultPageSize, (newVal) => {
  if (newVal !== undefined) {
    pageSize.value = newVal;
  }
});

const totalPages = computed(() => Math.max(1, Math.ceil(filteredItems.value.length / pageSize.value)));

const pagedItems = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filteredItems.value.slice(start, start + pageSize.value);
});

// Visible page numbers — show up to 5 around current
const visiblePages = computed(() => {
  const total = totalPages.value;
  const cur = currentPage.value;
  const delta = 2;
  const pages: (number | '…')[] = [];
  const lo = Math.max(1, cur - delta);
  const hi = Math.min(total, cur + delta);
  if (lo > 1) { pages.push(1); if (lo > 2) pages.push('…'); }
  for (let i = lo; i <= hi; i++) pages.push(i);
  if (hi < total) { if (hi < total - 1) pages.push('…'); pages.push(total); }
  return pages;
});

// Reset to page 1 when items list, filter, or page size changes
watch(() => props.items.length, () => { currentPage.value = 1; });
watch(pageSize, () => { currentPage.value = 1; });
watch(searchQuery, () => { currentPage.value = 1; });

// --- SELECTION ---
const selectedIds = ref<string[]>([]);

watch(() => props.items, () => {
  selectedIds.value = [];
  emit('selection-change', []);
});

const allSelected = computed(() =>
  filteredItems.value.length > 0 && filteredItems.value.every(i => selectedIds.value.includes(i._id || i.id))
);

const someSelected = computed(() => {
  const filtered = filteredItems.value;
  const count = filtered.filter(i => selectedIds.value.includes(i._id || i.id)).length;
  return count > 0 && count < filtered.length;
});

const toggleSelectAll = () => {
  const filteredIds = filteredItems.value.map(i => i._id || i.id);
  if (allSelected.value) {
    selectedIds.value = selectedIds.value.filter(id => !filteredIds.includes(id));
  } else {
    const merged = new Set([...selectedIds.value, ...filteredIds]);
    selectedIds.value = [...merged];
  }
  emit('selection-change', [...selectedIds.value]);
};

const toggleSelectItem = (id: string) => {
  const idx = selectedIds.value.indexOf(id);
  if (idx === -1) selectedIds.value.push(id);
  else selectedIds.value.splice(idx, 1);
  emit('selection-change', [...selectedIds.value]);
};

const isSelected = (id: string) => selectedIds.value.includes(id);

// --- SORT ---
const handleSort = (header: { key: string; sortable?: boolean }) => {
  if (!header.sortable) return;
  const newDir = props.sortKey === header.key && props.sortDir === 'asc' ? 'desc' : 'asc';
  if (props.storageKey) {
    try {
      localStorage.setItem(`${props.storageKey}-sort`, JSON.stringify({ key: header.key, dir: newDir }));
    } catch {
      /* ignore */
    }
  }
  emit('sort', { key: header.key, dir: newDir });
};

// --- COLUMN TOGGLING ---
const isColumnsDropdownOpen = ref(false);
const visibleKeys = ref<string[]>(props.headers.map(h => h.key));

const loadVisibleKeys = () => {
  if (!props.storageKey) {
    visibleKeys.value = props.headers.map(h => h.key);
    return;
  }
  try {
    const saved = localStorage.getItem(props.storageKey);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const valid = parsed.filter(k => props.headers.some(h => h.key === k));
        if (valid.length > 0) {
          visibleKeys.value = valid;
          return;
        }
      }
    }
  } catch {
    /* ignore parse errors */
  }
  visibleKeys.value = props.headers.map(h => h.key);
};

loadVisibleKeys();

watch(() => props.storageKey, loadVisibleKeys);

watch(() => props.headers, () => {
  if (props.storageKey) {
    loadVisibleKeys();
  } else {
    visibleKeys.value = props.headers.map(h => h.key);
  }
}, { deep: true });

const activeHeaders = computed(() => {
  if (!props.columnToggle && !props.storageKey) return props.headers;
  return props.headers.filter(h => visibleKeys.value.includes(h.key));
});

const toggleColumn = (key: string) => {
  const idx = visibleKeys.value.indexOf(key);
  if (idx !== -1) {
    if (visibleKeys.value.length > 1) {
      visibleKeys.value.splice(idx, 1);
    }
  } else {
    const allKeys = props.headers.map(h => h.key);
    const newKeys = [...visibleKeys.value, key];
    visibleKeys.value = allKeys.filter(k => newKeys.includes(k));
  }
  if (props.storageKey) {
    localStorage.setItem(props.storageKey, JSON.stringify(visibleKeys.value));
  }
};

const resetColumns = () => {
  visibleKeys.value = props.headers.map(h => h.key);
  if (props.storageKey) {
    localStorage.removeItem(props.storageKey);
  }
};
</script>

<template>
  <div class="bg-zinc-800 rounded-xl border border-zinc-700 overflow-hidden">
    <!-- Toolbar (Search bar & Column toggle) -->
    <div v-if="searchable || columnToggle || storageKey" class="px-4 py-3 border-b border-zinc-700 bg-surface/30 flex items-center justify-between gap-3">
      <div v-if="searchable" class="relative flex-1">
        <svg xmlns="http://www.w3.org/2000/svg" class="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-zinc-500 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"/>
        </svg>
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="searchPlaceholder"
          @paste="handleSearchPaste"
          class="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 placeholder-zinc-500 rounded-lg pl-9 pr-9 py-2 text-sm focus:outline-none focus:border-primary transition-colors"
        />
        <button
          v-if="searchQuery"
          @click="searchQuery = ''"
          class="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <!-- Column Toggle Dropdown -->
      <div v-if="columnToggle || storageKey" class="relative shrink-0">
        <BaseButton
          type="button"
          @click="isColumnsDropdownOpen = !isColumnsDropdownOpen"
          variant="secondary"
          size="sm"
          class="flex items-center gap-1.5"
          title="Toggle visible columns"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="size-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
          </svg>
          <span>Columns</span>
        </BaseButton>

        <!-- Dropdown Popover -->
        <div
          v-if="isColumnsDropdownOpen"
          class="absolute right-0 top-full mt-2 w-52 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 p-2 space-y-1"
        >
          <div class="px-2 py-1 text-xs font-bold text-zinc-400 border-b border-zinc-700/60 flex items-center justify-between">
            <span>Show / Hide Columns</span>
            <button
              type="button"
              @click="resetColumns"
              class="text-[10px] text-primary hover:underline font-normal cursor-pointer"
            >
              Reset
            </button>
          </div>
          <div class="max-h-60 overflow-y-auto py-1 space-y-0.5 custom-scrollbar">
            <label
              v-for="header in headers"
              :key="header.key"
              class="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-zinc-700/50 cursor-pointer text-xs select-none transition-colors"
            >
              <input
                type="checkbox"
                :checked="visibleKeys.includes(header.key)"
                :disabled="visibleKeys.includes(header.key) && visibleKeys.length === 1"
                @change="toggleColumn(header.key)"
                class="size-3.5 rounded border-zinc-600 bg-zinc-700 accent-primary cursor-pointer disabled:opacity-40"
              />
              <span class="text-zinc-200">{{ header.label }}</span>
            </label>
          </div>
        </div>

        <!-- Backdrop for click outside -->
        <div
          v-if="isColumnsDropdownOpen"
          @click="isColumnsDropdownOpen = false"
          class="fixed inset-0 z-40"
        />
      </div>
    </div>

    <div v-if="isLoading" class="p-12 text-center text-zinc-400 italic">
      Loading data...
    </div>

    <div v-else-if="filteredItems.length === 0" class="p-12 text-center text-zinc-400">
      <span v-if="searchQuery">No results for <span class="text-zinc-200 font-medium">"{{ searchQuery }}"</span>.</span>
      <span v-else>No records found.</span>
    </div>

    <div
      v-else
      class="overflow-x-auto custom-scrollbar"
      :class="[stickyHeader ? 'overflow-y-auto' : '']"
      :style="stickyHeader ? { maxHeight: maxHeight || 'calc(100vh - 280px)', minHeight: '180px' } : {}"
    >
      <table class="w-full text-left border-collapse">
        <thead :class="[stickyHeader ? 'sticky top-0 z-20 shadow-[0_1px_0_0_#3f3f46]' : '']">
          <tr class="bg-zinc-800 border-b border-zinc-700">
            <!-- Checkbox column -->
            <th
              v-if="selectable"
              class="px-4 py-4 w-10"
              :class="[stickyHeader ? 'sticky top-0 z-20 bg-zinc-800 shadow-[0_1px_0_0_#3f3f46]' : '']"
            >
              <input
                type="checkbox"
                :checked="allSelected"
                :indeterminate="someSelected"
                @change="toggleSelectAll"
                class="size-3.5 rounded border-zinc-600 bg-zinc-700 accent-primary cursor-pointer"
              />
            </th>
            <th
              v-for="header in activeHeaders"
              :key="header.key"
              :class="[
                'px-6 py-4 text-xs font-bold capitalize text-zinc-400',
                header.sortable ? 'cursor-pointer select-none hover:text-zinc-200 transition-colors' : '',
                stickyHeader ? 'sticky top-0 z-20 bg-zinc-800 shadow-[0_1px_0_0_#3f3f46]' : ''
              ]"
              @click="handleSort(header)"
            >
              <span class="flex items-center gap-1">
                {{ header.label }}
                <!-- Sort indicator: only show when actively sorting this column -->
                <svg
                  v-if="sortKey === header.key"
                  :class="['size-2.5 text-primary transition-transform', sortDir === 'desc' ? 'rotate-180' : '']"
                  viewBox="0 0 10 6"
                  fill="currentColor"
                >
                  <path d="M5 0L10 6H0L5 0Z"/>
                </svg>
              </span>
            </th>
            <th
              class="px-6 py-4 text-xs font-bold capitalize text-zinc-400 text-right"
              :class="[stickyHeader ? 'sticky top-0 z-20 bg-zinc-800 shadow-[0_1px_0_0_#3f3f46]' : '']"
            >
              Actions
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-zinc-700/50">
          <tr
            v-for="item in pagedItems"
            :key="item._id"
            :class="[
              'transition-colors group',
              selectable && isSelected(item._id || item.id)
                ? 'bg-primary/10 hover:bg-primary/15'
                : 'hover:bg-zinc-700/30'
            ]"
          >
            <!-- Checkbox cell -->
            <td v-if="selectable" class="px-4 py-4">
              <input
                type="checkbox"
                :checked="isSelected(item._id || item.id)"
                @change="toggleSelectItem(item._id || item.id)"
                class="size-3.5 rounded border-zinc-600 bg-zinc-700 accent-primary cursor-pointer"
              />
            </td>
            <td v-for="header in activeHeaders" :key="header.key" class="px-4 py-2 text-sm text-zinc-300">
              <slot :name="`cell-${header.key}`" :item="item">
                {{ item[header.key] }}
              </slot>
            </td>

            <td class="px-6 py-4 text-right">
              <div class="flex items-center justify-end gap-1">
                <slot name="row-actions" :item="item" />
                <BaseButton
                  @click="$emit('edit', item)"
                  title="Edit"
                  variant="ghost"
                  size="xs"
                  >
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </BaseButton>
                <BaseButton
                @click="$emit('delete', item._id || item.id)"
                title="Delete"
                variant="ghost"
                size="xs"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/>
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                  </svg>
                </BaseButton>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination footer -->
    <div v-if="!isLoading && filteredItems.length > 0" class="px-6 py-3 border-t border-zinc-700 flex flex-wrap items-center justify-between gap-3 bg-surface/30">
      <!-- Left: rows per page + count -->
      <div class="flex items-center gap-3 text-sm text-zinc-400">
        <span>Rows per page:</span>
        <select
          v-model="pageSize"
          class="bg-zinc-800 border border-zinc-700 text-zinc-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
        >
          <option v-for="opt in PAGE_SIZE_OPTIONS" :key="opt" :value="opt">{{ opt }}</option>
        </select>
      </div>

      <!-- Right: page controls -->
      <div class="flex items-center gap-1">
        <button
          @click="currentPage = 1"
          :disabled="currentPage === 1"
          class="px-2 py-1 rounded text-zinc-400 hover:text-text-main hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="First page"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 19l-7-7 7-7M18 19l-7-7 7-7"/></svg>
        </button>
        <button
          @click="currentPage--"
          :disabled="currentPage === 1"
          class="px-2 py-1 rounded text-zinc-400 hover:text-text-main hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Previous page"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
        </button>

        <template v-for="p in visiblePages" :key="p">
          <span v-if="p === '…'" class="px-1 text-zinc-600 select-none">…</span>
          <button
            v-else
            @click="currentPage = p as number"
            :class="[
              'w-8 h-8 rounded text-sm font-medium transition-colors',
              currentPage === p
                ? 'bg-primary text-text-main'
                : 'text-zinc-400 hover:text-text-main hover:bg-zinc-700'
            ]"
          >{{ p }}</button>
        </template>

        <button
          @click="currentPage++"
          :disabled="currentPage === totalPages"
          class="px-2 py-1 rounded text-zinc-400 hover:text-text-main hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Next page"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
        </button>
        <button
          @click="currentPage = totalPages"
          :disabled="currentPage === totalPages"
          class="px-2 py-1 rounded text-zinc-400 hover:text-text-main hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Last page"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 5l7 7-7 7M6 5l7 7-7 7"/></svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #3f3f46;
  border-radius: 10px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: #52525b;
}
</style>