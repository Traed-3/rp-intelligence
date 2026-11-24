'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { createEmployee } from './actions'

type ActionState = { error?: string; success?: boolean } | null

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'

const ROLES = [
  { value: 'shop_employee', label: 'Shop Technician' },
  { value: 'shop_manager',  label: 'Shop Manager' },
  { value: 'service_tech',  label: 'Service Tech' },
  { value: 'office_staff',  label: 'Office Staff' },
  { value: 'construction_admin', label: 'Construction Administrator' },
  { value: 'parts_manager', label: 'Parts Manager' },
  { value: 'viewer',        label: 'Viewer (read-only)' },
  { value: 'manager',       label: 'Manager' },
]

export function AddEmployeeForm() {
  const [open, setOpen] = useState(false)
  const [state, formAction, isPending] = useActionState(
    async (prev: ActionState, fd: FormData) => {
      const result = await createEmployee(prev, fd)
      if (result?.success) setOpen(false)
      return result
    },
    null
  )

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
      >
        + Add Employee
      </button>
    )
  }

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
      <h3 className="font-semibold text-gray-900 mb-4">Add New Employee</h3>
      <form action={formAction} className="space-y-4">
        {state?.error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {state.error}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
            <input
              name="full_name"
              required
              className={inputClass}
              placeholder="Jane Smith"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              name="email"
              type="email"
              required
              className={inputClass}
              placeholder="jane@company.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select name="role" className={inputClass} defaultValue="field_surveyor">
              {ROLES.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-xs text-gray-500">
          The employee will be added immediately. They can log in with their company Google account
          using this email and will have the role you set here.
        </p>
        <div className="flex gap-3">
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Adding…' : 'Add Employee'}
          </Button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
