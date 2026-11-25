function omissionReason(item) {
  const p = item.spatial?.position_local
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return '缺少有效的局部XY坐标；不使用Atlas坐标代替'
  if (typeof p.frame_id !== 'string' || !p.frame_id.trim()) return '缺少局部坐标系frame_id'
  if (item.spatial.unit !== 'm') return '坐标单位未知或不是米'
  return null
}

function axisProjection(values, invert = false) {
  const min = Math.min(...values), max = Math.max(...values)
  if (min === max) return () => 50
  const scale = Math.max(Math.abs(min), Math.abs(max), 1)
  const low = min / scale, range = max / scale - low
  return value => {
    const ratio = Math.max(0, Math.min(1, (value / scale - low) / range))
    return Number((5 + 90 * (invert ? 1 - ratio : ratio)).toFixed(4))
  }
}

export function prepareMap(candidates) {
  const groups = new Map(), omitted = []
  for (const item of candidates) {
    const reason = omissionReason(item)
    if (reason) {
      omitted.push({ id: item.anchor_id, label: item.canonical_name, reason })
      continue
    }
    const p = item.spatial.position_local, key = JSON.stringify([item.scene_id, p.frame_id])
    if (!groups.has(key)) groups.set(key, { scene_id: item.scene_id, frame_id: p.frame_id, points: [] })
    groups.get(key).points.push({
      id: item.anchor_id, label: item.canonical_name, frame_id: p.frame_id,
      x: p.x, y: p.y, z: Number.isFinite(p.z) ? p.z : null,
    })
  }
  const total_count = candidates.length, displayed_count = total_count - omitted.length
  const renders = []
  for (const { scene_id, frame_id, points } of groups.values()) {
    const x = axisProjection(points.map(p => p.x)), y = axisProjection(points.map(p => p.y), true)
    renders.push({
      mode: 'display', components: ['MapPreview'], locale: 'zh-CN',
      ...(groups.size > 1 ? { answer_presentation: 'supplement' } : {}),
      user_query: '用MapPreview完整展示places中的点位并显示名称；标题注明scene_id和frame_id，scene_id为空时注明场景未知。展示总记录数、总展示数、本图点数、coordinate_note，以及omitted中每项名称和原因。可用表格展示source_coordinates，注明单位米。不要增加点位或路线。',
      business_data: {
        scene_id, frame_id, unit: 'm', total_count, displayed_count, group_count: points.length,
        coordinate_note: '当前知识库语义点位示意图，不是实时机器人位置或导航路线，也不保证等于最新源地图快照。X、Y分别缩放至5–95，不能按图形比例判断真实距离或角度；源坐标Y越大，显示Y越小（上方）。同值轴居中。不同场景或坐标系分图展示，不能跨图比较位置。',
        places: points.map(p => ({ id: p.id, label: p.label, x: x(p.x), y: y(p.y) })),
        source_coordinates: points,
        omitted,
      },
    })
  }
  return { total_count, displayed_count, omitted, renders }
}
