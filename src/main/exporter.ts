// Module d'exportation des données de l'historique en Excel (.xlsx) et CSV (.csv).

import ExcelJS from 'exceljs';
import { DayData } from './types';

/** Génère un classeur Excel complet avec mise en page soignée et deux onglets */
export async function generateXlsx(days: DayData[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Pause';
    workbook.created = new Date();

    // Onglet 1 : Synthèse quotidienne
    const sheet1 = workbook.addWorksheet('Journées', {
        views: [{ state: 'frozen', ySplit: 1 }]
    });

    sheet1.columns = [
        { header: 'Date', key: 'date', width: 14 },
        { header: "Heure d'arrivée", key: 'clockIn', width: 16 },
        { header: 'Heure de sortie', key: 'departure', width: 16 },
        { header: 'Total pauses (min)', key: 'totalPauseMins', width: 20 },
        { header: 'Total pauses (format)', key: 'totalPauseFormatted', width: 20 },
        { header: 'Mode Ramadan', key: 'ramadan', width: 16 },
        { header: 'Nb pauses', key: 'pausesCount', width: 14 },
        { header: 'Détail des pauses', key: 'pausesDetail', width: 50 }
    ];

    // En-tête bleu Majorelle
    const headerRow1 = sheet1.getRow(1);
    headerRow1.height = 26;
    headerRow1.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow1.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF3B3DBF' }
    };
    headerRow1.alignment = { vertical: 'middle', horizontal: 'center' };

    days.forEach((day, index) => {
        const totalMins = day.totalPauseMins || 0;
        const pauses = day.pauses || [];
        const pausesDetail = pauses
            .map((p, i) => `#${i + 1}: ${p.start} - ${p.end} (${p.durationMins || 0} min)`)
            .join(' | ');

        const formattedMins = `${Math.floor(totalMins / 60)}h ${String(totalMins % 60).padStart(2, '0')}m`;

        const row = sheet1.addRow({
            date: day.date,
            clockIn: day.clockIn || '--:--',
            departure: day.departure || '--:--',
            totalPauseMins: totalMins,
            totalPauseFormatted: formattedMins,
            ramadan: day.ramadan ? 'Oui' : 'Non',
            pausesCount: pauses.length,
            pausesDetail: pausesDetail || 'Aucune pause'
        });

        if (index % 2 === 1) {
            row.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFF6F7FB' }
            };
        }
        row.alignment = { vertical: 'middle' };
        row.getCell('date').alignment = { vertical: 'middle', horizontal: 'center' };
        row.getCell('clockIn').alignment = { vertical: 'middle', horizontal: 'center' };
        row.getCell('departure').alignment = { vertical: 'middle', horizontal: 'center' };
        row.getCell('totalPauseMins').alignment = { vertical: 'middle', horizontal: 'right' };
        row.getCell('totalPauseFormatted').alignment = { vertical: 'middle', horizontal: 'center' };
        row.getCell('ramadan').alignment = { vertical: 'middle', horizontal: 'center' };
        row.getCell('pausesCount').alignment = { vertical: 'middle', horizontal: 'center' };
    });

    // Onglet 2 : Détail des pauses
    const sheet2 = workbook.addWorksheet('Détail des pauses', {
        views: [{ state: 'frozen', ySplit: 1 }]
    });

    sheet2.columns = [
        { header: 'Date', key: 'date', width: 14 },
        { header: 'N° Pause', key: 'position', width: 12 },
        { header: 'Heure début', key: 'start', width: 16 },
        { header: 'Heure fin', key: 'end', width: 16 },
        { header: 'Durée (minutes)', key: 'durationMins', width: 18 }
    ];

    const headerRow2 = sheet2.getRow(1);
    headerRow2.height = 26;
    headerRow2.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow2.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF171A3A' }
    };
    headerRow2.alignment = { vertical: 'middle', horizontal: 'center' };

    let pauseRowIdx = 0;
    days.forEach((day) => {
        (day.pauses || []).forEach((p, idx) => {
            const row = sheet2.addRow({
                date: day.date,
                position: p.position || idx + 1,
                start: p.start,
                end: p.end,
                durationMins: p.durationMins || 0
            });
            if (pauseRowIdx % 2 === 1) {
                row.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFF6F7FB' }
                };
            }
            row.alignment = { vertical: 'middle', horizontal: 'center' };
            pauseRowIdx++;
        });
    });

    const uint8Array = await workbook.xlsx.writeBuffer();
    return Buffer.from(uint8Array);
}

/** Génère un fichier CSV UTF-8 avec BOM (compatible Excel sans problème d'accents) */
export function generateCsv(days: DayData[]): string {
    const BOM = '\uFEFF';
    const header = [
        'Date',
        "Heure d'arrivée",
        'Heure de sortie',
        'Durée pauses (minutes)',
        'Durée pauses (formaté)',
        'Mode Ramadan',
        'Nombre de pauses',
        'Détail des pauses'
    ].join(';');

    const rows = days.map((day) => {
        const totalMins = day.totalPauseMins || 0;
        const formattedMins = `${Math.floor(totalMins / 60)}h ${String(totalMins % 60).padStart(2, '0')}m`;
        const pauses = day.pauses || [];
        const pausesDetail = pauses
            .map((p, i) => `#${i + 1}: ${p.start}-${p.end} (${p.durationMins || 0}m)`)
            .join(' | ');

        return [
            day.date,
            day.clockIn || '',
            day.departure || '',
            String(totalMins),
            formattedMins,
            day.ramadan ? 'Oui' : 'Non',
            String(pauses.length),
            `"${pausesDetail.replace(/"/g, '""')}"`
        ].join(';');
    });

    return BOM + [header, ...rows].join('\r\n');
}
