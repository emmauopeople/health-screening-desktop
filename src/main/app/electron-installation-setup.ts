import { dialog } from 'electron'
import { prepareInstallationSetup, type InstallationSetupResult } from './installation-setup'

export function prepareElectronInstallationSetup(
  userDataDirectory: string,
  receiptPath: string
): Promise<InstallationSetupResult | null> {
  return prepareInstallationSetup({
    userDataDirectory,
    receiptPath,
    async choose(hasExistingData) {
      const result = await dialog.showMessageBox({
        type: 'question',
        title: 'CHS — Installation configuration',
        message: hasExistingData ? 'Choose how to configure this installation' : 'Configure CHS',
        detail: hasExistingData
          ? 'Existing application data was found. Keep existing data to use the saved deployment, time zone, location, accounts, patient records, and pending work. You will sign in with your existing account.\n\nStart fresh opens the configuration form for a new deployment and administrator. A recovery copy of the previous data will be retained on this computer.'
          : 'Continue to configure the deployment, time zone, initial location, and administrator account.',
        buttons: hasExistingData
          ? ['Keep existing data', 'Start fresh', 'Exit']
          : ['Continue to configuration', 'Exit'],
        defaultId: 0,
        cancelId: hasExistingData ? 2 : 1,
        noLink: true
      })
      if (result.response === 0) return 'KEEP'
      return hasExistingData && result.response === 1 ? 'FRESH' : 'EXIT'
    },
    async confirmFresh() {
      const result = await dialog.showMessageBox({
        type: 'warning',
        title: 'CHS — Start fresh',
        message: 'Start a new deployment on this computer?',
        detail:
          'The new installation will have no existing patients, screenings, referrals, users, or synchronization configuration. Pending work will remain only in the recovery copy and will not be sent by the new installation.\n\nThe previous data will be moved to a recovery folder, not permanently erased. To continue using it normally, cancel and choose Keep existing data on the next launch.',
        buttons: ['Cancel', 'Start fresh'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
      return result.response === 1
    },
    async showRecoveryLocation(path) {
      await dialog.showMessageBox({
        type: 'info',
        title: 'CHS — Recovery copy saved',
        message: 'Your previous application data has been preserved',
        detail: `Recovery folder:\n${path}\n\nThis folder contains private application data. Keep it protected. Continue to configure the new deployment.`,
        buttons: ['Continue to configuration'],
        noLink: true
      })
    }
  })
}
