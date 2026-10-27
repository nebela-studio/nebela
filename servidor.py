# Servidor local del diseñador. Igual que "python -m http.server", pero le pide al
# navegador que no guarde copias viejas: así siempre se ve la última versión del programa.
import http.server
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))


class SinCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


http.server.ThreadingHTTPServer(('127.0.0.1', 8642), SinCache).serve_forever()
