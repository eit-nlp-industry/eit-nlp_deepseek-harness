// Short-lived view registry shared by camera_look and remember_person.
//
// The model cannot see structured tool values (only rendered text and images),
// so it cannot copy an attachment reference. camera_look registers the image
// here and prints a short id; remember_person resolves that id back to the ref.

const TTL_MS = 10 * 60 * 1000
const LIMIT = 64

let sequence = 0
const views = new Map()

export function putView(image) {
  const id = `v${++sequence}`
  views.set(id, { image, at: Date.now() })

  for (const [key, value] of views) {
    if (Date.now() - value.at > TTL_MS) views.delete(key)
  }
  while (views.size > LIMIT) {
    views.delete(views.keys().next().value)
  }
  return id
}

export function getView(id) {
  const entry = views.get(id)
  if (entry === undefined) return null
  if (Date.now() - entry.at > TTL_MS) {
    views.delete(id)
    return null
  }
  return entry.image
}
