import { useEffect, useRef } from 'react'
import { CHART_EFFECTS, DEFAULT_CHART, chartBox, chartResult, chartStats, drawChart, getChartColors, lineColor, pointColor, setChartColors, type ChartColors, type ChartDot } from '../../../shared/chart'
import { EFFECTS } from '../../../shared/labels'
import { t } from '../../../shared/i18n'

// A made-up chart for each skill with every evaluation in it, drawn in the colours being chosen, and a
// key naming each: the settings can be changed while looking at the result.
const SAMPLE: ChartDot[] = CHART_EFFECTS.flatMap((effect, i) => [0, 1].map(k => ({
  start: { x: 0.2 + 0.6 * ((i * 2 + k) / 11), y: 0.42 },
  end: { x: 0.08 + 0.84 * (((i * 2 + k) * 7) % 12) / 11, y: 0.62 + 0.3 * ((i + k * 3) % 6) / 5 },
  result: chartResult(effect), effect,
})))
const H = 300

export function ChartPreview({ colors }: { colors: ChartColors }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const width = Math.ceil(chartBox(1000, H, 'tl').h * 0.62 * 2 + 40)
  useEffect(() => {
    const c = ref.current?.getContext('2d')
    if (!c) return
    const before = getChartColors()
    setChartColors(colors)
    try {
      c.clearRect(0, 0, width, H)
      ;(['S', 'A'] as const).forEach((skill, i) => {
        const look = { lines: true, points: true, stats: false, name: false, colors: DEFAULT_CHART.colors }
        drawChart(c, { name: '', skill, dots: SAMPLE, stats: chartStats([], skill), look }, { x: i * (width / 2) + 10, y: 0, h: H })
      })
    } finally { setChartColors(before) }
  }, [colors, width])
  const look = { colors: DEFAULT_CHART.colors }
  const before = getChartColors()
  setChartColors(colors)
  const keyOf = (skill: 'A' | 'S') => CHART_EFFECTS.map(e => ({ e, name: EFFECTS[skill][e], line: lineColor(look, e, skill), point: pointColor(look, e, chartResult(e), skill) }))
  const keys = { S: keyOf('S'), A: keyOf('A') }
  setChartColors(before)
  return (
    <div className="chart-preview">
      <canvas ref={ref} width={width} height={H} aria-label={t('見本')} />
      <div className="chart-preview-keys">
        {(['S', 'A'] as const).map(skill => (
          <div key={skill}>
            <b>{skill === 'S' ? t('サーブ') : t('アタック')}</b>
            {keys[skill].map(k => (
              <span key={k.e} className="chart-key">
                <span className="chart-key-line" style={{ background: k.line }} /><span className="chart-key-dot" style={{ background: k.point }} />{`${k.e} ${k.name}`}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
