"use client"

import { useState, useEffect, useCallback } from 'react'
import { Check, Loader2 } from 'lucide-react'

interface SemanticView {
  id: string
  displayName: string
}

interface Preferences {
  theme: 'light' | 'dark' | 'system'
  numberFormat: 'US' | 'EU'
  dateFormat: string
  timezone: string
  defaultSemanticViewId: string
  preferredForecastModel: string
  cachePreference: 'aggressive' | 'normal' | 'none'
  maxDailyCredits: number
  creditsUsedToday: number
  showSQL: boolean
  showLineage: boolean
}

interface Props {
  userId: string
}

const DEFAULT_PREFS: Preferences = {
  theme: 'system',
  numberFormat: 'US',
  dateFormat: 'YYYY-MM-DD',
  timezone: 'UTC',
  defaultSemanticViewId: '',
  preferredForecastModel: 'auto',
  cachePreference: 'normal',
  maxDailyCredits: 100,
  creditsUsedToday: 0,
  showSQL: false,
  showLineage: true,
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-100 pb-1">
        {title}
      </p>
      {children}
    </div>
  )
}

function Field({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-700">{label}</p>
        {description && <p className="text-xs text-gray-400 mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        checked ? 'bg-indigo-600' : 'bg-gray-200'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

export default function PreferencesPanel({ userId }: Props) {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS)
  const [views, setViews] = useState<SemanticView[]>([])
  const [loading, setLoading] = useState(true)
  const [savedKey, setSavedKey] = useState<string | null>(null)

  // Load preferences and semantic views on mount
  useEffect(() => {
    let mounted = true
    Promise.all([
      fetch('/api/user/preferences').then(r => r.json()).catch(() => ({})),
      fetch('/api/semantic-views').then(r => r.json()).catch(() => []),
    ]).then(([prefData, viewData]) => {
      if (!mounted) return
      setPrefs(prev => ({ ...prev, ...prefData }))
      setViews(Array.isArray(viewData) ? viewData : viewData.views ?? [])
      setLoading(false)
    })
    return () => { mounted = false }
  }, [userId])

  const save = useCallback(async (key: string, value: unknown) => {
    setPrefs(prev => ({ ...prev, [key]: value }))
    setSavedKey(key)
    setTimeout(() => setSavedKey(k => (k === key ? null : k)), 2000)
    try {
      await fetch('/api/user/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      })
    } catch {
      // Optimistic — ignore errors silently for now
    }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-gray-400">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">Loading preferences…</span>
      </div>
    )
  }

  const creditsPct = prefs.maxDailyCredits > 0
    ? Math.min((prefs.creditsUsedToday / prefs.maxDailyCredits) * 100, 100)
    : 0

  const SavedBadge = ({ fieldKey }: { fieldKey: string }) =>
    savedKey === fieldKey ? (
      <span className="flex items-center gap-1 text-xs text-green-600">
        <Check size={11} /> Saved
      </span>
    ) : null

  return (
    <div className="flex flex-col gap-6 max-w-lg">
      {/* Display */}
      <Section title="Display">
        <Field label="Theme" description="UI color scheme">
          <div className="flex gap-2">
            {(['light', 'dark', 'system'] as const).map(t => (
              <label key={t} className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="radio"
                  name="theme"
                  value={t}
                  checked={prefs.theme === t}
                  onChange={() => save('theme', t)}
                  className="accent-indigo-600"
                />
                <span className="capitalize">{t}</span>
              </label>
            ))}
          </div>
        </Field>

        <Field label="Number format">
          <div className="flex gap-2">
            {(['US', 'EU'] as const).map(f => (
              <label key={f} className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="radio"
                  name="numberFormat"
                  value={f}
                  checked={prefs.numberFormat === f}
                  onChange={() => save('numberFormat', f)}
                  className="accent-indigo-600"
                />
                <span>{f === 'US' ? '1,234.56' : '1.234,56'}</span>
              </label>
            ))}
          </div>
        </Field>

        <Field label="Date format">
          <div className="flex items-center gap-2">
            <select
              value={prefs.dateFormat}
              onChange={e => save('dateFormat', e.target.value)}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
            </select>
            <SavedBadge fieldKey="dateFormat" />
          </div>
        </Field>

        <Field label="Timezone">
          <div className="flex items-center gap-2">
            <select
              value={prefs.timezone}
              onChange={e => save('timezone', e.target.value)}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              <option value="UTC">UTC</option>
              <option value="America/New_York">America/New_York</option>
              <option value="America/Chicago">America/Chicago</option>
              <option value="America/Denver">America/Denver</option>
              <option value="America/Los_Angeles">America/Los_Angeles</option>
              <option value="Europe/London">Europe/London</option>
              <option value="Europe/Paris">Europe/Paris</option>
              <option value="Asia/Tokyo">Asia/Tokyo</option>
              <option value="Asia/Singapore">Asia/Singapore</option>
            </select>
            <SavedBadge fieldKey="timezone" />
          </div>
        </Field>
      </Section>

      {/* Analysis */}
      <Section title="Analysis">
        <Field label="Default data view" description="Pre-selected in the query bar">
          <div className="flex items-center gap-2">
            <select
              value={prefs.defaultSemanticViewId}
              onChange={e => save('defaultSemanticViewId', e.target.value)}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              <option value="">None</option>
              {views.map(v => (
                <option key={v.id} value={v.id}>{v.displayName}</option>
              ))}
            </select>
            <SavedBadge fieldKey="defaultSemanticViewId" />
          </div>
        </Field>

        <Field label="Preferred forecast model">
          <div className="flex items-center gap-2">
            <select
              value={prefs.preferredForecastModel}
              onChange={e => save('preferredForecastModel', e.target.value)}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              <option value="auto">Auto (best fit)</option>
              <option value="prophet">Prophet</option>
              <option value="sarima">SARIMA</option>
              <option value="holtwinters">Holt-Winters</option>
              <option value="xgboost">XGBoost</option>
            </select>
            <SavedBadge fieldKey="preferredForecastModel" />
          </div>
        </Field>
      </Section>

      {/* Cache */}
      <Section title="Cache">
        <Field label="Cache preference" description="Controls how aggressively results are cached">
          <div className="flex flex-col gap-1.5">
            {(['aggressive', 'normal', 'none'] as const).map(c => (
              <label key={c} className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="radio"
                  name="cachePreference"
                  value={c}
                  checked={prefs.cachePreference === c}
                  onChange={() => save('cachePreference', c)}
                  className="accent-indigo-600"
                />
                <span className="capitalize">{c}</span>
              </label>
            ))}
          </div>
        </Field>
      </Section>

      {/* Budget */}
      <Section title="Budget">
        <Field label="Max daily credits" description="Queries are blocked when limit is reached">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={10000}
              step={10}
              value={prefs.maxDailyCredits}
              onChange={e => save('maxDailyCredits', Number(e.target.value))}
              className="w-24 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <SavedBadge fieldKey="maxDailyCredits" />
          </div>
        </Field>

        {/* Credit usage bar */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>Used today</span>
            <span>
              {prefs.creditsUsedToday.toFixed(2)} / {prefs.maxDailyCredits.toFixed(2)}
            </span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                creditsPct > 80
                  ? 'bg-red-500'
                  : creditsPct > 50
                  ? 'bg-amber-500'
                  : 'bg-green-500'
              }`}
              style={{ width: `${creditsPct}%` }}
            />
          </div>
        </div>
      </Section>

      {/* Advanced */}
      <Section title="Advanced">
        <Field label="Show SQL by default" description="Display generated SQL in every response">
          <div className="flex items-center gap-2">
            <Toggle checked={prefs.showSQL} onChange={v => save('showSQL', v)} />
            <SavedBadge fieldKey="showSQL" />
          </div>
        </Field>

        <Field label="Show lineage links" description="Display execution lineage on responses">
          <div className="flex items-center gap-2">
            <Toggle checked={prefs.showLineage} onChange={v => save('showLineage', v)} />
            <SavedBadge fieldKey="showLineage" />
          </div>
        </Field>
      </Section>
    </div>
  )
}
