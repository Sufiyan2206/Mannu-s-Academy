'use client';
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useApp } from '@/state/app';
import { AttReport } from '@/components/reports/AttReport';
import { OutReport } from '@/components/reports/OutReport';
import { ParentReports } from '@/components/reports/ParentReports';
import { ATT_REPORTS, OUT_REPORTS } from '@/components/reportKit';

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const app = useApp(), router = useRouter();
  const isAtt = ATT_REPORTS.some(r => r[0] === id), isOut = app.isAdmin && OUT_REPORTS.some(r => r[0] === id), isParent = app.isAdmin && id === 'parent';
  useEffect(() => { if (!isAtt && !isOut && !isParent) router.replace('/reports'); }, [isAtt, isOut, isParent, router]);
  if (isAtt) return <AttReport key={id} view={id} />;
  if (isOut) return <OutReport key={id} view={id} />;
  if (isParent) return <ParentReports />;
  return null;
}
