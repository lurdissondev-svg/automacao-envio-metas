import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { logger } from './logger.js';

// Secret gerado no startup — tokens invalidam ao reiniciar (sessão = enquanto o servidor rodar)
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');

const AUTH_USER = process.env.AUTH_USER || '';
const AUTH_PASS_HASH = process.env.AUTH_PASS_HASH || '';

export async function verifyLogin(username: string, password: string): Promise<string | null> {
  if (!AUTH_USER || !AUTH_PASS_HASH) {
    logger.error('AUTH_USER ou AUTH_PASS_HASH não configurados no .env');
    return null;
  }

  if (username !== AUTH_USER) {
    return null;
  }

  const valid = await bcrypt.compare(password, AUTH_PASS_HASH);
  if (!valid) {
    return null;
  }

  const token = jwt.sign({ user: username }, JWT_SECRET, { expiresIn: '24h' });
  logger.info('Login realizado', { user: username });
  return token;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Rotas públicas
  if (req.path === '/api/auth/login') {
    next();
    return;
  }

  // Rotas de API precisam de autenticação
  if (!req.path.startsWith('/api/')) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Token não fornecido' });
    return;
  }

  const token = authHeader.substring(7);
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Token inválido ou expirado' });
  }
}

// Utilitário para gerar hash de senha (usado uma vez para configurar)
export async function generateHash(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}
