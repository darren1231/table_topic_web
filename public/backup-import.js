(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BackupImport = factory();
})(globalThis, function () {
  function create({ document, storage, readBackup, getCloud, keys, supportsLanguage, confirm, toast, reload, schedule, t, ui }) {
    async function importFile(file) {
      try {
        const { payload, count, hasKeys } = readBackup(await file.text());
        const question = ui(`確定匯入 ${count} 筆練習資料並取代目前所有資料嗎？${hasKeys ? ' 此檔案包含 API Key。' : ''}`,
          `Import ${count} practices and replace all current data?${hasKeys ? ' This file contains API keys.' : ''}`);
        if (!confirm(question)) return;
        storage.setItem(keys.practice, JSON.stringify(payload.data.practice));
        storage.setItem(keys.ai, JSON.stringify(payload.data.aiSettings));
        if (supportsLanguage(payload.data.language)) storage.setItem(keys.language, payload.data.language);
        const cloud = getCloud();
        const updated = await cloud?.replaceData?.(payload.data.practice);
        // F05 remains a separate change: preserve the current cloud-failure contract.
        if (updated === false) {
          toast(ui('資料已匯入本機，但雲端更新失敗；請保持此頁開啟並重試',
            'Imported locally, but cloud update failed. Keep this page open and try again.'));
          return;
        }
        toast(cloud?.isEnabled?.() ? ui('匯入完成，雲端資料已更新', 'Import complete. Cloud data updated.')
          : ui('匯入完成，正在重新載入', 'Import complete. Reloading…'));
        schedule(reload, 700);
      } catch (error) {
        let message = error.message;
        if (error.messageKey) {
          const variables = { ...error.variables, category: t(`backup.category.${error.category}`) };
          message = t(error.messageKey, variables);
        } else if (error.name === 'SyntaxError') message = t('backup.invalid.json');
        toast(`${ui('匯入失敗', 'Import failed')}: ${message}`);
      } finally { document.getElementById('importBackupInput').value = ''; }
    }
    return { importFile };
  }
  return { create };
});
