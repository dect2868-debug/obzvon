<?php
/**
 * Сборщик статистики ОБЗВОН v6.1 — анонимный.
 *
 * Кладётся РЯДОМ с index.html (тот же домен — иначе сайт не сможет
 * обратиться к нему: в CSP разрешён только свой origin).
 *
 * Что делает:
 *   POST  → принимает событие {id, ev, ts} и пишет его в data/stats.json;
 *   GET   → отдаёт сводку: сколько людей заходило, сколько визитов,
 *           сколько калибровок и обзвонов.
 *
 * Личные данные не передаются: только случайный id устройства,
 * тип события и время.
 *
 * Включение: в config.json прописать
 *   "collect": { "url": "collect.php" }
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$dir  = __DIR__ . '/data';
$file = $dir . '/stats.json';

if (!is_dir($dir)) {
    @mkdir($dir, 0775, true);
}

function obz_read(string $file): array
{
    if (!file_exists($file)) {
        return ['people' => [], 'events' => [], 'updatedAt' => null, 'last' => 0];
    }
    $raw = @file_get_contents($file);
    $d = $raw ? json_decode($raw, true) : null;
    if (!is_array($d)) {
        return ['people' => [], 'events' => [], 'updatedAt' => null, 'last' => 0];
    }
    $d['people'] = isset($d['people']) && is_array($d['people']) ? $d['people'] : [];
    $d['events'] = isset($d['events']) && is_array($d['events']) ? $d['events'] : [];
    return $d;
}

function obz_write(string $file, array $data): void
{
    @file_put_contents($file, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
}

$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';

if ($method === 'POST') {
    $in = json_decode(file_get_contents('php://input'), true);
    if (!is_array($in) || !isset($in['id'], $in['ev'])) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'нужен id и ev']);
        exit;
    }
    $id = preg_replace('/[^a-z0-9]/i', '', (string)$in['id']);
    $ev = preg_replace('/[^a-z_.]/i', '', (string)$in['ev']);
    if ($id === '' || $ev === '') {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'пустые id или ev']);
        exit;
    }
    $ts = isset($in['ts']) ? (int)$in['ts'] : time() * 1000;

    $d = obz_read($file);
    $d['people'][$id] = (isset($d['people'][$id]) ? (int)$d['people'][$id] : 0) + 1;
    $d['events'][$ev] = (isset($d['events'][$ev]) ? (int)$d['events'][$ev] : 0) + 1;
    $d['last'] = $ts;
    $d['updatedAt'] = date('c');
    obz_write($file, $d);

    echo json_encode(['ok' => true]);
    exit;
}

if ($method === 'GET') {
    $d = obz_read($file);
    $visits = 0;
    foreach ($d['people'] as $n) {
        $visits += (int)$n;
    }
    echo json_encode([
        'ok'        => true,
        'visitors'  => count($d['people']),
        'visits'    => $visits,
        'events'    => $d['events'],
        'updatedAt' => $d['updatedAt'],
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

http_response_code(405);
echo json_encode(['ok' => false, 'error' => 'метод не поддерживается']);
