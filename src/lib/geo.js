export function parseNodeLocation(loc) {
  if (!loc) return null
  if (typeof loc === 'object' && Array.isArray(loc.coordinates)) {
    return { lon: loc.coordinates[0], lat: loc.coordinates[1] }
  }
  if (typeof loc === 'string') {
    try {
      const bytes = loc.match(/.{2}/g).map(b => parseInt(b, 16))
      const view = new DataView(new Uint8Array(bytes).buffer)
      const le = bytes[0] === 1
      const geomType = view.getUint32(1, le)
      const hasSRID = (geomType & 0x20000000) !== 0
      const offset = hasSRID ? 9 : 5
      return { lon: view.getFloat64(offset, le), lat: view.getFloat64(offset + 8, le) }
    } catch { return null }
  }
  return null
}
