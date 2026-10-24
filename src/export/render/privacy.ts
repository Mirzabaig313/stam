// Moved to the core so the sync engine (and its Rust port) share one privacy filter.
export { applyPrivacy, isLivingPerson, withoutDates } from "@/core/model/privacy";
