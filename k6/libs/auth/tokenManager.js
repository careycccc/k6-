import { check } from 'k6';
import { httpClient } from '../http/client.js';
import { logger } from '../utils/logger.js';

/**
 * Token管理器
 */
export class TokenManager {
  constructor(config = {}) {
    this.tokens = new Map();
    this.config = {
      authEndpoint: '/auth/login',
      refreshEndpoint: '/auth/refresh',
      tokenKey: 'access_token',
      refreshTokenKey: 'refresh_token',
      tokenExpiryBuffer: 30000, // 30秒缓冲
      ...config
    };
  }

  /**
   * 获取Token
   */
  async getToken(credentials, forceRefresh = false) {
    const tokenKey = this.getTokenKey(credentials);
    
    // 检查现有token是否有效
    if (!forceRefresh && this.isTokenValid(tokenKey)) {
      return this.tokens.get(tokenKey).accessToken;
    }
    
    // 获取新token
    return this.acquireToken(credentials);
  }

  /**
   * 获取Token Key
   */
  getTokenKey(credentials) {
    return `${credentials.username || credentials.client_id}:${this.config.authEndpoint}`;
  }

  /**
   * 检查Token是否有效
   */
  isTokenValid(tokenKey) {
    if (!this.tokens.has(tokenKey)) {
      return false;
    }
    
    const tokenData = this.tokens.get(tokenKey);
    const now = Date.now();
    const expiryTime = tokenData.createdAt + tokenData.expiresIn * 1000;
    
    return now < expiryTime - this.config.tokenExpiryBuffer;
  }

  /**
   * 获取Token
   */
  async acquireToken(credentials) {
    try {
      const response = await httpClient.post(this.config.authEndpoint, credentials, {
        validate: false,
        tags: { type: 'auth' }
      });
      
      if (!response.success) {
        throw new Error(`认证失败: ${response.status}`);
      }
      
      const tokenData = {
        accessToken: response.body[this.config.tokenKey],
        refreshToken: response.body[this.config.refreshTokenKey],
        expiresIn: response.body.expires_in || 3600,
        createdAt: Date.now()
      };
      
      const tokenKey = this.getTokenKey(credentials);
      this.tokens.set(tokenKey, tokenData);
      
      logger.info('Token获取成功', { user: credentials.username });
      
      return tokenData.accessToken;
    } catch (error) {
      logger.error('Token获取失败', error.message);
      throw error;
    }
  }

  /**
   * 刷新Token
   */
  async refreshToken(credentials) {
    const tokenKey = this.getTokenKey(credentials);
    const tokenData = this.tokens.get(tokenKey);
    
    if (!tokenData || !tokenData.refreshToken) {
      throw new Error('没有可用的刷新Token');
    }
    
    try {
      const response = await httpClient.post(this.config.refreshEndpoint, {
        refresh_token: tokenData.refreshToken
      }, {
        validate: false,
        tags: { type: 'auth' }
      });
      
      if (!response.success) {
        throw new Error(`Token刷新失败: ${response.status}`);
      }
      
      tokenData.accessToken = response.body[this.config.tokenKey];
      tokenData.expiresIn = response.body.expires_in || 3600;
      tokenData.createdAt = Date.now();
      
      this.tokens.set(tokenKey, tokenData);
      
      logger.info('Token刷新成功', { user: credentials.username });
      
      return tokenData.accessToken;
    } catch (error) {
      logger.error('Token刷新失败', error.message);
      this.tokens.delete(tokenKey);
      throw error;
    }
  }

  /**
   * 清除Token
   */
  clearToken(credentials) {
    const tokenKey = this.getTokenKey(credentials);
    this.tokens.delete(tokenKey);
    logger.info('Token已清除', { user: credentials.username });
  }

  /**
   * 批量获取Token
   */
  async getTokensBatch(credentialsList) {
    const tokens = {};
    
    for (const credentials of credentialsList) {
      try {
        const token = await this.getToken(credentials);
        const key = credentials.username || credentials.client_id;
        tokens[key] = token;
      } catch (error) {
        logger.error(`用户${credentials.username}Token获取失败`, error.message);
      }
    }
    
    return tokens;
  }
}

// 创建默认Token管理器实例
export const tokenManager = new TokenManager();

export default {
  TokenManager,
  tokenManager
};
