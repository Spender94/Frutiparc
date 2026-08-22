/*
 * Le service worker de l'appli Frutiparc (/light installé sur l'écran
 * d'accueil).
 *
 * Il ne fait QUE les notifications : pas de gestionnaire `fetch`, donc aucun
 * cache, aucune interception — la page, les jeux et Ruffle se chargent
 * exactement comme avant, et rien ici ne peut les casser. Son rôle est d'être
 * la partie de l'appli qui reste joignable quand tout le reste est fermé :
 * c'est lui que le service de poussée réveille.
 *
 * Le message poussé est un petit JSON chiffré par le serveur :
 *   { t: titre, c: corps, u: lien profond, tag: regroupement }
 * `tag` fait qu'un second courrier REMPLACE la notification du premier au
 * lieu d'empiler ; `u` porte où atterrir (« ?ouvre=mail »…).
 */
'use strict';

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; }
  catch (err) { d = { t: 'Frutiparc', c: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.t || 'Frutiparc', {
    body: d.c || '',
    icon: '/images/appli/icone-192.png',
    badge: '/images/appli/badge-96.png',
    tag: d.tag || 'frutiparc',
    lang: 'fr',
    data: { u: d.u || '/light' },
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var u = (e.notification.data && e.notification.data.u) || '/light';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (fenetres) {
    for (var i = 0; i < fenetres.length; i++) {
      var f = fenetres[i];
      // Une page /light est déjà ouverte : on la ramène au premier plan et on
      // lui SOUFFLE le lien profond — pas de rechargement, elle route seule.
      if (f.url.indexOf('/light') >= 0 && 'focus' in f) {
        try {
          var p = new URL(u, self.location.origin).searchParams;
          f.postMessage({ ouvre: p.get('ouvre') || '', avec: p.get('avec') || '' });
        } catch (err) { /* lien illisible : le focus suffit */ }
        return f.focus();
      }
    }
    return self.clients.openWindow(u);
  }));
});

// Le service de poussée peut remplacer l'abonnement de sa propre initiative
// (rotation de clés, ménage). On se réabonne dans la foulée et on prévient le
// serveur en lui donnant l'ANCIEN endpoint — c'est lui qui porte l'identité.
self.addEventListener('pushsubscriptionchange', function (e) {
  var ancien = (e.oldSubscription && e.oldSubscription.endpoint) || '';
  e.waitUntil(
    fetch('/api/push/cle').then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.ok) throw new Error('cle indisponible');
      var cle = Uint8Array.from(atob(j.cle.replace(/-/g, '+').replace(/_/g, '/')), function (c) { return c.charCodeAt(0); });
      return self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cle });
    }).then(function (sub) {
      return fetch('/api/push/resubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ancien: ancien, subscription: sub.toJSON() }),
      });
    }).catch(function () { /* le prochain passage dans l'appli réabonnera */ })
  );
});
