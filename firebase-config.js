/*
  Permit tracker settings. Edit the values below, then save the file.
  These values are NOT secret. Your Firestore rules (firestore.rules) are what protect your data.

  Where to find the firebase block:
  Firebase console > Project settings (gear icon) > General > Your apps > Web app > SDK setup and configuration > Config
*/
window.PERMIT_CONFIG = {
  firebase: {
    apiKey: "AIzaSyC_SqQ7H0oOdXvgLjnaLsOOg1nzt3O2yTI",
    authDomain: "business-compliance-trac-da301.firebaseapp.com",
    projectId: "business-compliance-trac-da301",
    appId: "1:661845375833:web:0f724e8e5ebc5db62aea48"
  },

  // The Google account that owns this tracker. It must match the email in firestore.rules.
  // The first time this account signs in, it becomes the Owner.
  ownerEmail: "businesscompliance180@gmail.com"
};
