/**
 * Custom ESLint rules for async error handling pattern enforcement
 * These rules help prevent the specific issues identified in PR #31
 */

module.exports = {
  // Rule to detect next(error) without return statement
  'require-return-before-next-error': {
    meta: {
      type: 'problem',
      docs: {
        description: 'Require return statement before next(error) calls to prevent continued execution',
        category: 'Possible Errors',
        recommended: true,
      },
      fixable: 'code',
      schema: [],
      messages: {
        missingReturn: 'Missing return statement before next(error). This can cause "Cannot set headers after they are sent" errors.',
      },
    },
    create(context) {
      return {
        CallExpression(node) {
          // Check for next(createError(...)) or next(error) patterns
          if (
            node.callee.name === 'next' &&
            node.arguments.length === 1 &&
            (
              // next(createError(...))
              (node.arguments[0].type === 'CallExpression' && 
               node.arguments[0].callee.name === 'createError') ||
              // next(error) where error is an identifier
              (node.arguments[0].type === 'Identifier' && 
               node.arguments[0].name === 'error')
            )
          ) {
            // Check if this is inside a catch block
            let parent = node.parent;
            let isInCatchBlock = false;
            
            while (parent) {
              if (parent.type === 'CatchClause') {
                isInCatchBlock = true;
                break;
              }
              parent = parent.parent;
            }
            
            if (isInCatchBlock) {
              // Check if there's a return statement before this call
              const statement = context.getAncestors().find(ancestor => 
                ancestor.type === 'ExpressionStatement' && 
                ancestor.expression === node
              );
              
              if (statement && statement.parent.type === 'BlockStatement') {
                const statements = statement.parent.body;
                const currentIndex = statements.indexOf(statement);
                
                // Check if this is the last statement or if there are statements after
                if (currentIndex < statements.length - 1) {
                  context.report({
                    node,
                    messageId: 'missingReturn',
                    fix(fixer) {
                      return fixer.insertTextBefore(node, 'return ');
                    },
                  });
                }
                
                // Also check if this statement doesn't start with 'return'
                const sourceCode = context.getSourceCode();
                const statementText = sourceCode.getText(statement);
                if (!statementText.trim().startsWith('return')) {
                  context.report({
                    node,
                    messageId: 'missingReturn',
                    fix(fixer) {
                      return fixer.insertTextBefore(node, 'return ');
                    },
                  });
                }
              }
            }
          }
        },
      };
    },
  },

  // Rule to detect potential async/await issues in route handlers
  'async-route-error-handling': {
    meta: {
      type: 'problem',
      docs: {
        description: 'Ensure async route handlers properly handle errors',
        category: 'Best Practices',
        recommended: true,
      },
      schema: [],
      messages: {
        missingTryCatch: 'Async route handler should use try/catch or asyncHandler wrapper',
        unusedAsyncHandler: 'Consider using asyncHandler wrapper for cleaner error handling',
      },
    },
    create(context) {
      return {
        FunctionExpression(node) {
          // Check if this is an async function used as a route handler
          if (
            node.async &&
            node.params.length >= 3 && // (req, res, next)
            node.params[2].name === 'next'
          ) {
            // Check if the function body contains try/catch
            let hasTryCatch = false;
            
            function checkForTryCatch(bodyNode) {
              if (bodyNode.type === 'TryStatement') {
                hasTryCatch = true;
                return;
              }
              
              if (bodyNode.body) {
                if (Array.isArray(bodyNode.body)) {
                  bodyNode.body.forEach(checkForTryCatch);
                } else {
                  checkForTryCatch(bodyNode.body);
                }
              }
            }
            
            checkForTryCatch(node.body);
            
            if (!hasTryCatch) {
              context.report({
                node,
                messageId: 'missingTryCatch',
              });
            }
          }
        },
      };
    },
  },
};