# SMA_forecast_charging

Achtung NUR für den Wechselrichter SUNNY_TRIPOWER _10.0_SE von SMA. Es werden keine anderen unterstützt. 

Das Script wurde im gänze verändert und dient dem Laden bei günstigen Preisen und entladen bei hohen.
Es nutzt den Tibberlink Adapter für die Preise, dieser muss installiert und konfiguriert sein, sowie einer PV Prognose von solcast.com, hier muss man sich registrieren und ein Token generieren.
 

![tree](https://github.com/arteck/SMA_forecast_charging/blob/master/SUNNY_TRIPOWER%20_10.0_SE/datenpunkte.png)






# OLD Version 
SMA prognosebasierte Ladung mit ioBroker 

Mit diesen Scripten soll die prognosebasierte Ladung von SMA Batteriewechselrichtern mittels ioBroker verbessert werden. Grund sind die jahrelang ungelösten Probleme des SMA HomeManagers, vorallem im bereich der fehlerhaften bzw schlechten Prognose. Die Details können hier nachgelesen werden: https://www.photovoltaikforum.com/thread/119955-warum-wird-eingespeist-und-nicht-der-akku-geladen/

Für Hilfe oder Diskussionen rund um das Projekt bitte hier lang: https://www.photovoltaikforum.com/thread/142863-prognosebasierte-ladung-mittels-iobroker/

Zum Einsatz kommen die Prognosen von Solcast (https://solcast.com/), es ist jedoch denkbar auch andere Prognosesysteme zu verwenden. 
Entsprechende Code Anpassungen sollten sich aus dem Quelltext entnehmen lassen.

Zusätzlich ist eine Ladung mit Netzstrom implementiert bei Einsatz dynamischer Strompreise des Anbieters Awattar Deutschland (https://www.awattar.de/) und Tibber (https://invite.tibber.com/7e8d4d4b). Weitere Anbieter sind realisierbar.
Dies ermöglich Lade- und Entladeregelungen nach Strompreisen, dies ist z.b sinnvoll bei stark negativen Strompreisen. Diese Funktion ist optional.

Diese Scripte berücksichtigen keine Verbraucher in den Planungen! Die Arbeit der Scripte beruhen ausschließlich auf Standort bezogene Prognosen. 
