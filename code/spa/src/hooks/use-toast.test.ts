import { describe, it, expect, beforeEach, vi } from "vitest"
import { reducer, useToast, toast } from "./use-toast"

describe("use-toast", () => {
  beforeEach(() => {
    // Reset the state between tests
    vi.clearAllMocks()
  })

  describe("reducer", () => {
    it("should add a toast", () => {
      const initialState = { toasts: [] }
      const newToast = { id: "1", title: "Test", open: true }
      const result = reducer(initialState, { type: "ADD_TOAST", toast: newToast })

      expect(result.toasts).toHaveLength(1)
      expect(result.toasts[0]).toEqual(newToast)
    })

    it("should limit toasts to TOAST_LIMIT (1)", () => {
      let state = { toasts: [] }
      state = reducer(state, { type: "ADD_TOAST", toast: { id: "1", title: "First", open: true } })
      state = reducer(state, { type: "ADD_TOAST", toast: { id: "2", title: "Second", open: true } })

      expect(state.toasts).toHaveLength(1)
      expect(state.toasts[0].id).toBe("2")
    })

    it("should update a toast", () => {
      const initialState = { toasts: [{ id: "1", title: "Original", open: true }] }
      const result = reducer(initialState, { type: "UPDATE_TOAST", toast: { id: "1", title: "Updated" } })

      expect(result.toasts[0].title).toBe("Updated")
      expect(result.toasts[0].open).toBe(true)
    })

    it("should dismiss a specific toast", () => {
      const initialState = { toasts: [{ id: "1", title: "Test", open: true }] }
      const result = reducer(initialState, { type: "DISMISS_TOAST", toastId: "1" })

      expect(result.toasts[0].open).toBe(false)
    })

    it("should dismiss all toasts when toastId is undefined", () => {
      const initialState = {
        toasts: [
          { id: "1", title: "Test1", open: true },
          { id: "2", title: "Test2", open: true },
        ],
      }
      const result = reducer(initialState, { type: "DISMISS_TOAST", toastId: undefined })

      expect(result.toasts.every((t) => !t.open)).toBe(true)
    })

    it("should remove a specific toast", () => {
      const initialState = {
        toasts: [
          { id: "1", title: "Test1", open: false },
          { id: "2", title: "Test2", open: false },
        ],
      }
      const result = reducer(initialState, { type: "REMOVE_TOAST", toastId: "1" })

      expect(result.toasts).toHaveLength(1)
      expect(result.toasts[0].id).toBe("2")
    })

    it("should remove all toasts when toastId is undefined", () => {
      const initialState = {
        toasts: [
          { id: "1", title: "Test1", open: false },
          { id: "2", title: "Test2", open: false },
        ],
      }
      const result = reducer(initialState, { type: "REMOVE_TOAST", toastId: undefined })

      expect(result.toasts).toHaveLength(0)
    })

    it("should not update non-matching toast", () => {
      const initialState = { toasts: [{ id: "1", title: "Original", open: true }] }
      const result = reducer(initialState, { type: "UPDATE_TOAST", toast: { id: "999", title: "Updated" } })

      expect(result.toasts[0].title).toBe("Original")
    })
  })

  describe("toast function", () => {
    it("should create a toast with auto-dismiss capability", () => {
      const result = toast({ title: "Test Toast", description: "Test description" })

      expect(result.id).toBeDefined()
      expect(result.dismiss).toBeDefined()
      expect(result.update).toBeDefined()
    })

    it("should allow dismissing a toast", () => {
      const result = toast({ title: "Test Toast" })
      expect(() => result.dismiss()).not.toThrow()
    })

    it("should allow updating a toast", () => {
      const result = toast({ title: "Test Toast" })
      expect(() => result.update({ title: "Updated Toast" })).not.toThrow()
    })
  })

  describe("useToast hook", () => {
    it("should return initial empty state", () => {
      const { toasts } = useToast()
      expect(toasts).toBeDefined()
    })

    it("should provide toast function", () => {
      const { toast: toastFn } = useToast()
      expect(typeof toastFn).toBe("function")
    })

    it("should provide dismiss function", () => {
      const { dismiss } = useToast()
      expect(typeof dismiss).toBe("function")
    })

    it("should handle dismiss without toastId", () => {
      const { dismiss } = useToast()
      expect(() => dismiss()).not.toThrow()
    })

    it("should handle dismiss with toastId", () => {
      const { dismiss } = useToast()
      expect(() => dismiss("test-id")).not.toThrow()
    })
  })
})
