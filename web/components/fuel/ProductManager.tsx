import { useEffect, useId, useRef, useState } from 'react'
import type { FuelProduct } from '../../../shared/types.ts'
import { useArchiveFuelProduct } from '../../api/fuel.ts'
import { Button } from '../Button.tsx'
import { useToast } from '../Toast.tsx'
import { labText } from './fuelText.ts'
import { ProductForm } from './ProductForm.tsx'
import labStyles from './FuelLab.module.css'
import styles from './ProductManager.module.css'

export interface ProductManagerProps {
  /** The runner's live products; archived ones leave the list. */
  products: FuelProduct[]
}

/**
 * The runner's product list: each product with its serving and the carbohydrate and sodium in it,
 * a form to add one and to change one, and Archive (a product is archived and never deleted, so
 * old logs keep its name and amounts). The pick list of the fuel log reads the same list.
 */
export function ProductManager({ products }: ProductManagerProps) {
  const headingId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const toast = useToast()
  const archive = useArchiveFuelProduct()
  /** The id of the product being changed, `'new'` for the add form, or null. */
  const [editing, setEditing] = useState<{ id: string } | 'new' | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [refocus, setRefocus] = useState(0)

  // A row that leaves the list takes the focused button with it, so focus goes to the heading.
  useEffect(() => {
    if (refocus > 0) heading.current?.focus()
  }, [refocus])

  function close(): void {
    setEditing(null)
    setRefocus((count) => count + 1)
  }

  function archiveProduct(product: FuelProduct): void {
    setFailure(null)
    archive.mutateAsync(product.id).then(
      () => {
        toast.show(labText.archived(product.name))
        setRefocus((count) => count + 1)
      },
      (error: Error) => {
        setFailure(labText.archiveFailed(error.message))
      },
    )
  }

  return (
    <section aria-labelledby={headingId} className={labStyles.section}>
      <h2 id={headingId} ref={heading} tabIndex={-1} className={labStyles.heading}>
        {labText.productsHeading()}
      </h2>
      <p className={labStyles.lead}>{labText.productsLead()}</p>
      {products.length === 0 ? (
        editing === 'new' ? null : (
          <p className={labStyles.note}>{labText.productsEmpty()}</p>
        )
      ) : (
        <ul className={labStyles.list}>
          {products.map((product) => (
            <li key={product.id} className={labStyles.item}>
              {editing !== null && editing !== 'new' && editing.id === product.id ? (
                <ProductForm product={product} onClose={close} />
              ) : (
                <>
                  <p className={styles.name}>
                    <span>{product.name}</span>
                    {product.multiCarb ? (
                      <span className={styles.tag}>{labText.multiCarbTag()}</span>
                    ) : null}
                  </p>
                  <p className={labStyles.note}>{labText.productAmounts(product)}</p>
                  <div className={labStyles.actions}>
                    <Button
                      variant="secondary"
                      aria-label={labText.editProduct(product.name)}
                      onClick={() => {
                        setEditing({ id: product.id })
                      }}
                    >
                      {labText.edit()}
                    </Button>
                    <Button
                      variant="quiet"
                      aria-label={labText.archiveProduct(product.name)}
                      loading={archive.isPending && archive.variables === product.id}
                      onClick={() => {
                        archiveProduct(product)
                      }}
                    >
                      {labText.archive()}
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {failure === null ? null : (
        <p role="alert" className={labStyles.error}>
          {failure}
        </p>
      )}
      {editing === 'new' ? (
        <ProductForm product={null} onClose={close} />
      ) : (
        <div className={labStyles.actions}>
          <Button
            variant="secondary"
            onClick={() => {
              setEditing('new')
            }}
          >
            {labText.addProduct()}
          </Button>
        </div>
      )}
    </section>
  )
}
