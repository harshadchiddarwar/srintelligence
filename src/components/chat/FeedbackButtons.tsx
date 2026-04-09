"use client"

import { useState } from 'react'
import { ThumbsUp, ThumbsDown, X, Send, Check } from 'lucide-react'

interface Props {
  lineageId?: string
  executionId?: string
  stepId?: string
  agentName: string
}

type Rating = 'positive' | 'negative' | null

const CATEGORIES = [
  { value: 'correct', label: 'Correct & helpful' },
  { value: 'incorrect_data', label: 'Incorrect data' },
  { value: 'incorrect_sql', label: 'Incorrect SQL' },
  { value: 'slow', label: 'Too slow' },
  { value: 'unclear', label: 'Unclear response' },
  { value: 'other', label: 'Other' },
]

export default function FeedbackButtons({ lineageId, executionId, stepId, agentName }: Props) {
  const [rating, setRating] = useState<Rating>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [category, setCategory] = useState('')
  const [comment, setComment] = useState('')
  const [correctedSQL, setCorrectedSQL] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const openModal = (r: Rating) => {
    setRating(r)
    setModalOpen(true)
    setSubmitted(false)
    setCategory('')
    setComment('')
    setCorrectedSQL('')
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineageId,
          executionId,
          stepId,
          agentName,
          rating,
          category,
          comment,
          correctedSQL: category === 'incorrect_sql' ? correctedSQL : undefined,
        }),
      })
      setSubmitted(true)
      setTimeout(() => {
        setModalOpen(false)
      }, 1500)
    } catch {
      // Ignore — optimistic close
      setModalOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative inline-flex items-center gap-1">
      {/* Thumbs up */}
      <button
        onClick={() => openModal('positive')}
        className={`rounded p-1 transition-colors ${
          rating === 'positive'
            ? 'text-green-600 bg-green-50'
            : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
        }`}
        title="Helpful"
        aria-label="Mark as helpful"
      >
        <ThumbsUp size={13} />
      </button>

      {/* Thumbs down */}
      <button
        onClick={() => openModal('negative')}
        className={`rounded p-1 transition-colors ${
          rating === 'negative'
            ? 'text-red-500 bg-red-50'
            : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
        }`}
        title="Not helpful"
        aria-label="Mark as not helpful"
      >
        <ThumbsDown size={13} />
      </button>

      {/* Slide-up modal card */}
      {modalOpen && (
        <>
          {/* Backdrop (transparent — just catches outside clicks) */}
          <div
            className="fixed inset-0 z-20"
            onClick={() => !submitting && setModalOpen(false)}
          />

          <div className="absolute bottom-8 left-0 z-30 w-80 rounded-xl border border-gray-200 bg-white shadow-xl p-4 flex flex-col gap-3">
            {/* Header */}
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">
                {rating === 'positive' ? '👍 Helpful?' : '👎 What went wrong?'}
              </p>
              <button
                onClick={() => setModalOpen(false)}
                disabled={submitting}
                className="rounded p-0.5 text-gray-400 hover:text-gray-600"
              >
                <X size={14} />
              </button>
            </div>

            {submitted ? (
              <div className="flex items-center gap-2 py-2 text-green-700">
                <Check size={16} />
                <span className="text-sm font-medium">Thanks for your feedback!</span>
              </div>
            ) : (
              <>
                {/* Category */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  >
                    <option value="">Select a category…</option>
                    {CATEGORIES.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>

                {/* Comment */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Comment (optional)</label>
                  <textarea
                    value={comment}
                    onChange={e => setComment(e.target.value)}
                    rows={2}
                    placeholder="Tell us more…"
                    className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                </div>

                {/* Corrected SQL (only when category is incorrect_sql) */}
                {category === 'incorrect_sql' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Corrected SQL
                    </label>
                    <textarea
                      value={correctedSQL}
                      onChange={e => setCorrectedSQL(e.target.value)}
                      rows={4}
                      placeholder="Paste the correct SQL here…"
                      className="w-full rounded-lg border border-gray-200 bg-gray-900 text-gray-100 px-2.5 py-1.5 text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                )}

                {/* Submit */}
                <button
                  onClick={handleSubmit}
                  disabled={submitting || !category}
                  className="flex items-center justify-center gap-1.5 w-full rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Send size={12} />
                  {submitting ? 'Submitting…' : 'Submit feedback'}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
