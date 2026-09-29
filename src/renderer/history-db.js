// Version bureau : l'historique SQLite est un fichier géré par le processus principal.
// Cet objet garde la même interface que HistoryDb de l'extension pour que history.js
// tourne sans modification, mais délègue tout à psHistory (IPC).

const HistoryDb = {
    listDays: (opts) => window.psHistory.listDays(opts),
    exportFile: () => window.psHistory.exportFile(),
    deleteDay: (date) => window.psHistory.deleteDay(date),
    onChange: (cb) => window.psHistory.onChange(cb),
    isWasmBlocked: () => false // plus de contrainte CSP WebAssembly : le moteur tourne côté principal
};
