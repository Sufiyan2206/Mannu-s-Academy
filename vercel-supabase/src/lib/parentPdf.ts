// The parent monthly report as an A5 PDF, drawn in the browser with jsPDF (no server needed).
import { jsPDF } from 'jspdf';
import { dp, tz } from './format';
import { pdfText, type ParentData } from './parent';

export interface Logo { dataUrl: string; w: number; h: number }

export async function loadLogo(url = '/brand/logo-pdf.png'): Promise<Logo | null> {
  try {
    const blob = await (await fetch(url)).blob();
    const dataUrl: string = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(blob); });
    const size: { w: number; h: number } = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = rej; i.src = dataUrl; });
    return { dataUrl, ...size };
  } catch { return null; }
}

export function buildParentPdf(d: ParentData, logo: Logo | null): Blob {
  const W = 419.53, H = 595.28, M = 26, CW = W - 2 * M, LIMIT = H - 44;
  const doc = new jsPDF({ unit: 'pt', format: [W, H], compress: true });
  const rgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const fill = (h: string) => doc.setFillColor(...rgb(h)), ink = (h: string) => doc.setTextColor(...rgb(h)), stroke = (h: string) => doc.setDrawColor(...rgb(h));
  const NAVY = '#1c2b45', GOLD = '#c8921b', INK = '#1a2233', GREY = '#5b6577', LINE = '#d8dee9';
  const COL: Record<string, string> = { present: '#15803d', late: '#15803d', absent: '#b91c1c', cancelled: '#6b7280', not_recorded: '#b45309', upcoming: '#6b7280' };
  const FC: Record<string, string> = { paid: '#15803d', part: '#b45309', due: '#b91c1c', not_billed: '#6b7280' };

  type TO = { width?: number; align?: 'left' | 'center' | 'right' };
  const T = (str: unknown, x: number, y: number, size: number, bold: boolean, color: string, o: TO = {}) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); ink(color);
    let t = pdfText(str);
    if (o.width) while (t.length > 1 && doc.getTextWidth(t) > o.width) t = t.slice(0, -2) + '.';
    doc.text(t, x, y + size * 0.8, { align: o.align || 'left' });
  };
  const wrap = (str: string, x: number, y: number, size: number, color: string, width: number, lh: number) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(size); ink(color);
    const lines = doc.splitTextToSize(pdfText(str), width) as string[];
    lines.forEach((l, i) => doc.text(l, x, y + size * 0.8 + i * lh));
    return y + lines.length * lh;
  };
  const money = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: d.fee.currency, currencyDisplay: 'code', minimumFractionDigits: dp(d.fee.currency), maximumFractionDigits: dp(d.fee.currency) }).format(v).replace(/ /g, ' ');
  const shortDue = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'));
  let y = 0;

  const header = (small: boolean) => {
    const hh = small ? 38 : 66;
    fill(NAVY); doc.rect(0, 0, W, hh, 'F'); fill(GOLD); doc.rect(0, hh, W, 3, 'F');
    const lh = hh - (small ? 10 : 18);
    if (logo) { try { doc.addImage(logo.dataUrl, 'PNG', 16, small ? 5 : 9, lh * logo.w / logo.h, lh); } catch { /* the logo is optional */ } }
    const lx = small ? 52 : 78;
    T(d.academy, lx, small ? 13 : 15, small ? 11 : 14, true, '#ffffff', { width: W - lx - 16 });
    if (small) T(`${d.student.name} · ${d.month_label}`, lx, 26, 8, false, '#f1c15a', { width: W - lx - 16 });
    else T('Monthly Attendance Report', lx, 36, 10.5, false, '#f1c15a');
    y = hh + 18;
  };
  const ensure = (h: number) => { if (y + h > LIMIT) { doc.addPage(); header(true); } };

  header(false);
  T('STUDENT', M, y, 8, false, GREY); y += 12;
  T(d.student.name, M, y, 19, true, INK, { width: CW }); y += 27;
  const info: [string, string][] = [['Month', d.month_label], ['Subject', d.subject.name], ['Class', d.student.batch], ...(d.teacher ? [['Teacher', d.teacher] as [string, string]] : [])];
  for (const [k, v] of info) { T(k, M, y, 10.5, false, GREY); T(v, M + 62, y, 10.5, true, INK, { width: CW - 62 }); y += 17; }

  y += 4; const s = d.summary; ensure(120); T('Summary', M, y, 13, true, INK); y += 21;
  const tiles: [string, string, string][] = [['Classes held', String(s.held), NAVY], ['Attended', String(s.attended), '#15803d'], ['Missed', String(s.missed), s.missed ? '#b91c1c' : INK], ['Attendance', s.percent == null ? '-' : s.percent + '%', NAVY]];
  const tw = (CW - 21) / 4;
  tiles.forEach(([k, v, c], i) => {
    const x = M + i * (tw + 7);
    fill('#fbfcfe'); stroke(LINE); doc.setLineWidth(1); doc.roundedRect(x, y, tw, 56, 8, 8, 'FD');
    T(v, x + tw / 2, y + 10, v.length > 4 ? 16 : 21, true, c, { align: 'center' }); T(k, x + tw / 2, y + 38, 8.5, false, GREY, { align: 'center' });
  });
  y += 66;
  const extra: string[] = [];
  if (s.cancelled) extra.push(`${s.cancelled} ${s.cancelled === 1 ? 'class was' : 'classes were'} cancelled and ${s.cancelled === 1 ? 'is' : 'are'} not counted.`);
  if (s.late) extra.push(`${s.late} of the attended classes ${s.late === 1 ? 'was' : 'were'} joined late.`);
  if (s.pending) extra.push(`${s.pending} ${s.pending === 1 ? 'class is' : 'classes are'} not yet recorded or still to come.`);
  if (extra.length) y = wrap(extra.join(' '), M, y, 9.5, GREY, CW, 12) + 6;
  y += 8;

  ensure(100); fill('#fbfcfe'); stroke(LINE); doc.roundedRect(M, y, CW, 82, 9, 9, 'FD');
  const fx = M + 14, fmo = d.fee.month, multi = fmo.subjects > 1;
  T(`${multi ? 'FEES' : 'FEE'} FOR ${d.month_label.toUpperCase()}`, fx, y + 11, 8, false, GREY);
  T(!fmo.billed && !fmo.total ? '-' : money(fmo.total), fx, y + 24, 22, true, INK);
  T(multi ? `${fmo.subjects} subjects · ${d.fee.classes} classes each · paid in advance` : `for ${d.fee.classes} classes · collected in advance`, fx, y + 54, 9, false, GREY, { width: CW - 28 - 126 });
  const pw = 118, px = M + CW - pw - 14;
  T('PAYMENT STATUS', px + pw / 2, y + 11, 8, false, GREY, { align: 'center' });
  fill(FC[fmo.state]); doc.roundedRect(px, y + 26, pw, 26, 13, 13, 'F');
  T(fmo.label, px + pw / 2, y + 34, fmo.label.length > 12 ? 8.5 : 10, true, '#ffffff', { align: 'center' });
  const fnote = fmo.state === 'part' ? `${money(fmo.paid)} received · ${money(fmo.outstanding)} due` : fmo.state === 'due' ? `${money(fmo.outstanding)} due${fmo.due_date ? ' · ' + shortDue(fmo.due_date) : ''}` : fmo.state === 'paid' ? 'Thank you' : '';
  if (fnote) T(fnote, px + pw / 2, y + 58, 8.5, false, GREY, { align: 'center' });
  y += 98;

  const RH = 21, ol = d.fee.owed;
  ensure(ol.lines.length ? 66 + RH * Math.min(ol.lines.length, 2) : 50);
  T('Outstanding fees', M, y, 13, true, INK);
  T(`as of ${new Intl.DateTimeFormat('en-GB', { timeZone: tz(), weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date())}`, W - M, y + 4, 8.5, false, GREY, { align: 'right' });
  y += 21;
  if (!ol.lines.length) {
    fill('#ecf8f0'); doc.roundedRect(M, y, CW, 34, 8, 8, 'F'); T('No outstanding fees. Thank you.', M + CW / 2, y + 11, 11, true, '#15803d', { align: 'center' }); y += 50;
  } else {
    const oHead = () => { fill(NAVY); doc.rect(M, y, CW, 22, 'F'); T('Fee', M + 10, y + 6.5, 9.5, true, '#ffffff'); T('Due', M + 190, y + 6.5, 9.5, true, '#ffffff'); T('Amount', W - M - 10, y + 6.5, 9.5, true, '#ffffff', { align: 'right' }); y += 22; };
    oHead();
    ol.lines.forEach((l, i) => {
      if (y + RH > LIMIT - 30) { doc.addPage(); header(true); oHead(); }
      if (i % 2) { fill('#f5f7fb'); doc.rect(M, y, CW, RH, 'F'); }
      stroke('#e3e8f0'); doc.setLineWidth(0.5); doc.line(M, y + RH, M + CW, y + RH);
      T(`${l.period_label} · ${l.subject}`, M + 10, y + 5.5, 10.5, false, INK, { width: 175 });
      T(shortDue(l.due_date), M + 190, y + 6, 9.5, l.overdue, l.overdue ? '#b91c1c' : GREY);
      T(money(l.outstanding), W - M - 10, y + 5.5, 10.5, true, INK, { align: 'right' });
      y += RH;
    });
    if (y + 40 > LIMIT) { doc.addPage(); header(true); }
    fill('#fdf2f2'); doc.rect(M, y, CW, 30, 'F');
    T('Total outstanding', M + 10, y + 9, 11.5, true, '#b91c1c'); T(money(ol.total), W - M - 10, y + 9, 11.5, true, '#b91c1c', { align: 'right' }); y += 36;
    const bits: string[] = [];
    if (ol.previous > 0) bits.push(`${money(ol.previous)} is from earlier months`);
    if (ol.later > 0) bits.push(`${money(ol.later)} is for later months`);
    if (bits.length) y = wrap(bits.join(' · ') + '.', M, y, 9.5, GREY, CW, 12) + 4;
    y += 10;
  }

  if (d.fee.month_fees.length > 1) {
    ensure(44 + RH * d.fee.month_fees.length);
    T(`All subjects - ${d.month_label}`, M, y, 13, true, INK); y += 21;
    fill(NAVY); doc.rect(M, y, CW, 22, 'F'); T('Subject', M + 10, y + 6.5, 9.5, true, '#ffffff'); T('Fee', M + 140, y + 6.5, 9.5, true, '#ffffff'); T('Payment', M + 238, y + 6.5, 9.5, true, '#ffffff'); y += 22;
    d.fee.month_fees.forEach((mf, i) => {
      if (i % 2) { fill('#f5f7fb'); doc.rect(M, y, CW, RH, 'F'); }
      stroke('#e3e8f0'); doc.setLineWidth(0.5); doc.line(M, y + RH, M + CW, y + RH);
      T(mf.subject, M + 10, y + 5.5, 10.5, mf.current, INK, { width: 125 });
      T(mf.amount == null ? '-' : money(mf.amount), M + 140, y + 5.5, 10.5, false, INK);
      fill(FC[mf.state]); doc.circle(M + 242, y + 10.5, 3.4, 'F');
      T(mf.label === 'NOT YET RECORDED' ? 'Not yet recorded' : mf.label.charAt(0) + mf.label.slice(1).toLowerCase(), M + 252, y + 6.2, 9, true, FC[mf.state]);
      y += RH;
    });
    y += 14;
  }

  const cDate = M + 10, cTime = M + 168, cStat = M + 238;
  const tableHead = () => { fill(NAVY); doc.rect(M, y, CW, 22, 'F'); T('Date', cDate, y + 6.5, 9.5, true, '#ffffff'); T('Time', cTime, y + 6.5, 9.5, true, '#ffffff'); T('Status', cStat, y + 6.5, 9.5, true, '#ffffff'); y += 22; };
  ensure(22 + 21 + 24 * Math.min(Math.max(d.rows.length, 1), 7));
  T('Class by class', M, y, 13, true, INK); y += 21; tableHead();
  if (!d.rows.length) { T('No classes were scheduled this month.', cDate, y + 8, 10.5, false, GREY); y += 30; }
  d.rows.forEach((r, i) => {
    if (y + 24 > LIMIT) { doc.addPage(); header(true); tableHead(); }
    if (i % 2) { fill('#f5f7fb'); doc.rect(M, y, CW, 24, 'F'); }
    stroke('#e3e8f0'); doc.setLineWidth(0.5); doc.line(M, y + 24, M + CW, y + 24);
    T(r.date, cDate, y + 6.5, 10.5, false, INK, { width: 150 }); T(r.time, cTime, y + 6.5, 10.5, false, GREY, { width: 66 });
    fill(COL[r.status]); doc.circle(cStat + 4, y + 12, 3.4, 'F'); T(r.label, cStat + 13, y + 6.8, 10, true, COL[r.status], { width: CW - 254 });
    y += 24;
  });

  y += 18; ensure(70); fill(GOLD); doc.roundedRect(M, y, CW, 3, 1.5, 1.5, 'F'); y += 12;
  y = wrap(d.note, M, y, 11, INK, CW, 14) + 6;
  if (d.contact) y = wrap(d.contact, M, y, 9.5, GREY, CW, 12) + 4;
  T(d.academy, M, y + 4, 10, true, INK, { width: CW });
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); stroke(LINE); doc.setLineWidth(0.5); doc.line(M, H - 32, W - M, H - 32);
    T(`Prepared on ${d.generated_label}`, M, H - 25, 7.5, false, '#8b95a7'); T(`Page ${i} of ${n}`, W - M, H - 25, 7.5, false, '#8b95a7', { align: 'right' });
  }
  doc.setProperties({ title: `Monthly Attendance Report - ${pdfText(d.student.name)} - ${d.month_label}`, author: pdfText(d.academy), subject: `${pdfText(d.subject.name)}, ${d.month_label}` });
  return doc.output('blob');
}
